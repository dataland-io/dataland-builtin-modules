import {
  CronEvent,
  TableSyncRequest,
  Transaction,
  getDbClient,
  registerCronHandler,
  registerTransactionHandler,
  valueToScalar,
} from "@dataland-io/dataland-sdk";
import { Client } from "@dataland-workerlibs/mysql";
import { tableFromJSON, tableToIPC } from "apache-arrow";
import { oneLine } from "common-tags";
import { Column, PrimaryKeyColumn, TableMapping } from "./types";
import {
  getColumns,
  getConnectedClient,
  getDoWriteback,
  getMysqlDb,
  getPrimaryKeyColumns,
  getTableMapping,
  postprocessRows,
} from "./utils";

const db = getDbClient();

registerCronHandler(async (cronEvent: CronEvent) => {
  console.log("Starting cron sync", CronEvent.toJsonString(cronEvent));

  const t0 = performance.now();

  const mysqlDb = getMysqlDb();
  const tableMapping = getTableMapping();

  const client = await getConnectedClient();

  try {
    const sourceTableNames = Object.keys(tableMapping);
    const allPrimaryKeyColumns = await getPrimaryKeyColumns(
      client,
      mysqlDb,
      sourceTableNames
    );

    for (const sourceTableName of sourceTableNames) {
      const primaryKeyColumns = allPrimaryKeyColumns.get(sourceTableName);
      if (primaryKeyColumns == null) {
        console.warn(
          `Primary keys not found, skipping ingestion for table - ${sourceTableName}`
        );
        continue;
      }
      const primaryKeyColumnNames = [...primaryKeyColumns.keys()];

      const targetTableName = tableMapping[sourceTableName]!;

      try {
        await ingestTable(
          client,
          sourceTableName,
          targetTableName,
          primaryKeyColumnNames
        );
      } catch (error) {
        console.warn(
          "Failed to ingest table",
          sourceTableName,
          targetTableName,
          error
        );
      }
    }

    console.log("Completed cron sync", { total: performance.now() - t0 });
  } finally {
    await client.close();
  }
});

const ingestTable = async (
  client: Client,
  sourceTableName: string,
  targetTableName: string,
  primaryKeyColumnNames: string[]
) => {
  console.log(
    `Ingesting MySQL table "${sourceTableName}" to Dataland table "${targetTableName}"`
  );

  const t0 = performance.now();

  const rows = await client.query(`select * from ??`, [sourceTableName]);

  const t1 = performance.now();

  // TODO(hzuo): Empty tables are harder to handle because we need to manually construct an empty
  //  Arrow Table with the correct types, without relying on `tableFromJSON` to do the work for us.
  //  But we should definitely still handle it.
  if (rows.length === 0) {
    console.log("Skipping empty table", sourceTableName);
    return;
  }

  postprocessRows(rows);
  const arrowTable = tableFromJSON(rows);
  const arrowRecordBatch = tableToIPC(arrowTable);
  const tableSyncRequest: TableSyncRequest = {
    tableName: targetTableName,
    arrowRecordBatches: [arrowRecordBatch],
    primaryKeyColumnNames,
    deleteExtraRows: true,
    dropExtraColumns: false,
    tableAnnotations: {},
    columnAnnotations: {},
    transactionAnnotations: {},
  };

  const t2 = performance.now();

  await db.tableSync(tableSyncRequest);

  const t3 = performance.now();

  console.log("Ingestion complete", {
    numRows: rows.length,
    total: t3 - t0,
    load: t1 - t0,
    arrow: t2 - t1,
    store: t3 - t2,
  });
};

registerTransactionHandler(async (transaction: Transaction) => {
  const t0 = performance.now();

  const doWriteback = getDoWriteback();
  if (!doWriteback) {
    return;
  }

  const mysqlDb = getMysqlDb();
  const tableMapping = getTableMapping();

  // TODO(hzuo): Don't re-connect for each new transaction
  const client = await getConnectedClient();

  const t1 = performance.now();

  const sourceTableNames = Object.keys(tableMapping);

  try {
    // partition columnNames into primaryKeyColumnNames and ordinaryColumnNames
    const [allPrimaryKeyColumns, allColumns] = await Promise.all([
      getPrimaryKeyColumns(client, mysqlDb, sourceTableNames),
      getColumns(client, mysqlDb, sourceTableNames),
    ]);

    const t2 = performance.now();

    const writes = translateTransaction(
      transaction,
      mysqlDb,
      tableMapping,
      allPrimaryKeyColumns,
      allColumns
    );

    if (writes.length === 0) {
      return;
    }

    console.log("Replicating transaction", {
      transactionId: transaction.transactionId,
      logicalTimestamp: transaction.logicalTimestamp,
      numMutations: transaction.mutations.length,
      numWrites: writes.length,
    });

    console.log("Applying writes", writes);

    const t3 = performance.now();

    await client.transaction(async (connection) => {
      for (const [query, params] of writes) {
        try {
          await connection.execute(query, params);
        } catch (error) {
          throw new Error(
            `Writeback failed - query <${query}> - params ${JSON.stringify(
              params
            )}`,
            {
              cause: error,
            }
          );
        }
      }
    });

    const t4 = performance.now();

    console.log("Completed replicating transaction", {
      transactionId: transaction.transactionId,
      logicalTimestamp: transaction.logicalTimestamp,
      numMutations: transaction.mutations.length,
      total: t4 - t0,
      connect: t1 - t0,
      fetchschema: t2 - t1,
      translate: t3 - t2,
      write: t4 - t3,
    });
  } finally {
    await client.close();
  }
});

const translateTransaction = (
  transaction: Transaction,
  mysqlDb: string,
  tableMapping: TableMapping,
  allPrimaryKeyColumns: Map<string, Map<string, PrimaryKeyColumn>>,
  allColumns: Map<string, Map<string, Column>>
): [string, unknown[]][] => {
  const writes: [string, unknown[]][] = [];

  for (const sourceTableName in tableMapping) {
    // `getTableMapping` checks that the source <-> target table mapping is 1:1
    // so we are guaranteed to see each `targetTableName` exactly once
    const targetTableName = tableMapping[sourceTableName];

    const dataChangeRecord = transaction.dataChangeRecords[targetTableName];
    if (dataChangeRecord == null) {
      // this table was unaffected by this transaction
      continue;
    }

    const sourceTableColumns = allColumns.get(sourceTableName);
    const primaryKeyColumns = allPrimaryKeyColumns.get(sourceTableName);

    if (sourceTableColumns == null || sourceTableColumns.size === 0) {
      throw new Error(`Columns not found - ${sourceTableName}`);
    }
    if (primaryKeyColumns == null || primaryKeyColumns.size === 0) {
      throw new Error(`Primary keys not found - ${sourceTableName}`);
    }

    const primaryKeyColumnNames = [...primaryKeyColumns.keys()];

    // sanity check that source table columns is a superset of the primary key columns
    for (const primaryKeyColumnName of primaryKeyColumnNames) {
      if (!sourceTableColumns.has(primaryKeyColumnName)) {
        throw new Error(
          `Primary key is missing from source table - pk ${primaryKeyColumnName} - source ${sourceTableName}`
        );
      }
    }

    const targetTableColumnNames = new Set(dataChangeRecord.columnNames);

    // also check that the target table columns is a superset of the primary key columns
    // otherwise all of our queries will fail
    for (const primaryKeyColumnName of primaryKeyColumnNames) {
      if (!targetTableColumnNames.has(primaryKeyColumnName)) {
        throw new Error(
          oneLine`
            Primary key is missing from target table
            - pk ${primaryKeyColumnName} - source ${sourceTableName} - target ${targetTableName}
          `
        );
      }
    }

    const columnNames: string[] = [];
    const valueIndexes: number[] = [];
    for (let i = 0; i < dataChangeRecord.columnNames.length; i++) {
      const columnName = dataChangeRecord.columnNames[i];
      if (sourceTableColumns.has(columnName)) {
        columnNames.push(columnName);
        valueIndexes.push(i);
      }
    }

    const primaryKeyValueIndexes: number[] = [];
    for (const primaryKey of primaryKeyColumnNames) {
      const i = columnNames.findIndex((c) => c === primaryKey);
      if (i === -1) {
        // should be impossible because the above checks imply that
        // `primaryKeyColumnNames` is a subset of the `columnNames`
        throw new Error(
          "invariant failed - primaryKeyColumnNames is not a subset of columnNames"
        );
      }
      const valueIndex = valueIndexes[i];
      primaryKeyValueIndexes.push(valueIndex);
    }

    const insertQuery = getInsertQuery(mysqlDb, sourceTableName, columnNames);
    const updateQuery = getUpdateQuery(
      mysqlDb,
      sourceTableName,
      columnNames,
      primaryKeyColumnNames
    );
    const deleteQuery = getDeleteQuery(
      mysqlDb,
      sourceTableName,
      primaryKeyColumnNames
    );

    for (const insertedRow of dataChangeRecord.insertedRows) {
      const values = insertedRow.values;
      if (values == null) {
        continue;
      }
      const scalars = valueIndexes.map((i) => valueToScalar(values.values[i]));
      writes.push([insertQuery, scalars]);
    }
    for (const updatedRow of dataChangeRecord.updatedRows) {
      const values = updatedRow.values;
      if (values == null) {
        continue;
      }
      const scalars = [];
      for (const valueIndex of valueIndexes) {
        scalars.push(valueToScalar(values.values[valueIndex]));
      }
      for (const valueIndex of primaryKeyValueIndexes) {
        scalars.push(valueToScalar(values.values[valueIndex]));
      }
      writes.push([updateQuery, scalars]);
    }
    for (const deletedRow of dataChangeRecord.deletedRows) {
      const values = deletedRow.values;
      if (values == null) {
        continue;
      }
      const scalars = primaryKeyValueIndexes.map((i) =>
        valueToScalar(values.values[i])
      );
      writes.push([deleteQuery, scalars]);
    }
  }

  return writes;
};

const getInsertQuery = (
  mysqlDb: string,
  tableName: string,
  columnNames: string[]
) => {
  const columnList = columnNames.join(", ");
  const paramList = columnNames.map(() => "?").join(", ");
  const query = `insert into ${mysqlDb}.${tableName} (${columnList}) values (${paramList})`;
  return query;
};

const getUpdateQuery = (
  mysqlDb: string,
  tableName: string,
  columnNames: string[],
  primaryKeyColumnNames: string[]
) => {
  const assigmentList = columnNames.map((c) => `${c} = ?`).join(", ");

  // We expect `columnNames.length` parameters, instead of repeating the primary key column values
  // as additional parameters - this logic re-uses the existing parameters that correspond to the
  // primary key columns.
  const conditionList = primaryKeyColumnNames
    .map((c) => {
      const columnIndex = columnNames.findIndex((c2) => c2 === c);
      if (columnIndex < 0) {
        throw new Error(
          "getUpdateQuery - invariant failed - primaryKeyColumnNames is not a subset of columnNames"
        );
      }
      return `${c} = ?`;
    })
    .join(" and ");

  const query = `update ${mysqlDb}.${tableName} set ${assigmentList} where ${conditionList}`;
  return query;
};

const getDeleteQuery = (
  mysqlDb: string,
  tableName: string,
  primaryKeyColumnNames: string[]
) => {
  const conditionList = primaryKeyColumnNames
    .map((c) => `${c} = ?`)
    .join(" and ");
  const query = `delete from ${mysqlDb}.${tableName} where ${conditionList}`;
  return query;
};
