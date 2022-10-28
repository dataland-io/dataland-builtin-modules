import {
  AddColumn,
  ChangeColumnNullable,
  ColumnDescriptor,
  CreateTable,
  DataType,
  DeleteRows,
  DropColumn,
  DropTable,
  InsertRows,
  ListValue,
  Mutation,
  Struct,
  Transaction,
  UpdateRows,
  Value,
  assertNever,
  invariant,
  valueToScalar,
} from "@dataland-io/dataland-sdk";

export const translateTransaction = (
  transaction: Transaction,
  pgSchema: string
): [string, unknown[]][] => {
  const writes: [string, unknown[]][] = [];
  for (const mutation of transaction.mutations) {
    const writesForMutation = translateMutation(mutation, pgSchema);
    writes.push(...writesForMutation);
  }
  return writes;
};

export const translateMutation = (
  mutation0: Mutation,
  pgSchema0: string
): [string, unknown[]][] => {
  const mutation = mutation0.kind;
  if (mutation.oneofKind == null) {
    return [];
  }
  const pgSchema = quoteIdentifier(pgSchema0);
  switch (mutation.oneofKind) {
    case "insertRows": {
      const insertRows: InsertRows = mutation.insertRows;
      const tableName = quoteIdentifier(insertRows.tableName);
      const columnNames = insertRows.columnNames.map((columnName) =>
        quoteIdentifier(columnName)
      );

      const allColumnNames = ["_row_id", ...columnNames];
      const columnList = allColumnNames.join(", ");
      const paramList = allColumnNames
        .map((_ignored, i) => `$${i + 1}`)
        .join(", ");
      const statement = `insert into ${pgSchema}.${tableName} (${columnList}) values (${paramList})`;

      const writes: [string, unknown[]][] = [];
      for (const row of insertRows.rows) {
        if (row.values == null) {
          continue;
        }
        invariant(row.values.values.length === insertRows.columnNames.length);
        const params: unknown[] = [String(row.rowId)];
        for (const value of row.values.values) {
          params.push(valueToScalar(value));
        }
        writes.push([statement, params]);
      }
      return writes;
    }
    case "updateRows": {
      const updateRows: UpdateRows = mutation.updateRows;
      const tableName = quoteIdentifier(updateRows.tableName);
      const columnNames = updateRows.columnNames.map((columnName) =>
        quoteIdentifier(columnName)
      );

      if (columnNames.length === 0) {
        return [];
      }

      const assigmentList = columnNames
        .map((c, i) => `${c} = $${i + 2}`)
        .join(", ");
      const statement = `update ${pgSchema}.${tableName} set ${assigmentList} where _row_id = $1`;

      const writes: [string, unknown[]][] = [];
      for (const row of updateRows.rows) {
        if (row.values == null) {
          continue;
        }
        invariant(row.values.values.length === updateRows.columnNames.length);
        const params: unknown[] = [String(row.rowId)];
        for (const value of row.values.values) {
          params.push(valueToScalar(value));
        }
        writes.push([statement, params]);
      }
      return writes;
    }
    case "deleteRows": {
      const deleteRows: DeleteRows = mutation.deleteRows;
      const tableName = quoteIdentifier(deleteRows.tableName);
      const statement = `delete from ${pgSchema}.${tableName} where _row_id = $1`;
      const writes = deleteRows.rowIds.map((rowId) => {
        const write: [string, unknown[]] = [statement, [rowId]];
        return write;
      });
      return writes;
    }
    case "addColumn": {
      const addColumn: AddColumn = mutation.addColumn;
      const tableName = quoteIdentifier(addColumn.tableName);
      if (addColumn.columnDescriptor == null) {
        return [];
      }
      const columnDefinition = getPostgresColumnDefinition(
        addColumn.columnDescriptor
      );
      // prettier-ignore
      const statement = `alter table ${pgSchema}.${tableName} add column ${columnDefinition}`;
      return [[statement, []]];
    }
    case "dropColumn": {
      const dropColumn: DropColumn = mutation.dropColumn;
      const tableName = quoteIdentifier(dropColumn.tableName);
      const columnName = quoteIdentifier(dropColumn.columnName);
      const statement = `alter table ${pgSchema}.${tableName} drop column ${columnName}`;
      return [[statement, []]];
    }
    case "changeColumnNullable": {
      const changeColumnNullable: ChangeColumnNullable =
        mutation.changeColumnNullable;
      const tableName = quoteIdentifier(changeColumnNullable.tableName);
      const columnName = quoteIdentifier(changeColumnNullable.columnName);
      if (changeColumnNullable.nullable) {
        const statement = `alter table ${pgSchema}.${tableName} alter column ${columnName} drop not null`;
        return [[statement, []]];
      } else {
        const statement = `alter table ${pgSchema}.${tableName} alter column ${columnName} set not null`;
        return [[statement, []]];
      }
    }
    case "setColumnAnnotation": {
      // TODO(hzuo): Store in meta table
      return [];
    }
    case "createTable": {
      const createTable: CreateTable = mutation.createTable;
      if (createTable.tableDescriptor == null) {
        return [];
      }
      const tableDescriptor = createTable.tableDescriptor;
      const tableName = quoteIdentifier(tableDescriptor.tableName);
      const columnDefinitions = tableDescriptor.columnDescriptors.map((c) =>
        getPostgresColumnDefinition(c)
      );
      const allColumnDefinitions = [
        "_row_id int8 primary key",
        ...columnDefinitions,
      ];
      // prettier-ignore
      const statement = `create table ${pgSchema}.${tableName} (${allColumnDefinitions.join(",")})`;
      return [[statement, []]];
    }
    case "dropTable": {
      const dropTable: DropTable = mutation.dropTable;
      const tableName = quoteIdentifier(dropTable.tableName);
      const statement = `drop table ${pgSchema}.${tableName}`;
      return [[statement, []]];
    }
    case "setTableAnnotation": {
      // TODO(hzuo): Store in meta table
      return [];
    }
    default: {
      assertNever(mutation);
    }
  }
};

export const quoteIdentifier = (identifier: string): string => {
  return '"' + identifier.replaceAll('"', '""') + '"';
};

export const quoteStringValue = (stringValue: string): string => {
  return "'" + stringValue.replaceAll("'", "''") + "'";
};

export const quoteValue = (value0: Value): string => {
  const value = value0.kind;
  if (value.oneofKind == null) {
    throw new Error("invalid Value");
  }
  switch (value.oneofKind) {
    case "nullValue": {
      return "null";
    }
    case "numberValue": {
      return String(value.numberValue);
    }
    case "stringValue": {
      return quoteStringValue(value.stringValue);
    }
    case "boolValue": {
      return String(value.boolValue);
    }
    case "structValue": {
      return quoteStringValue(Struct.toJsonString(value.structValue));
    }
    case "listValue": {
      return quoteStringValue(ListValue.toJsonString(value.listValue));
    }
    default: {
      assertNever(value);
    }
  }
};

export const getPostgresDataType = (dataType: DataType): string => {
  switch (dataType) {
    case DataType.UNKNOWN_DATA_TYPE:
      throw new Error("unknown data type");
    case DataType.BOOL:
      return "bool";
    case DataType.INT32:
      return "int4";
    case DataType.INT64:
      return "int8";
    case DataType.FLOAT32:
      return "float4";
    case DataType.FLOAT64:
      return "float8";
    case DataType.STRING:
      return "text";
    default:
      assertNever(dataType);
  }
};

export const getPostgresColumnDefinition = (
  columnDescriptor: ColumnDescriptor
): string => {
  const components = [];
  components.push(quoteIdentifier(columnDescriptor.columnName));
  components.push(getPostgresDataType(columnDescriptor.dataType));
  if (columnDescriptor.dataType === DataType.STRING) {
    components.push(`collate "C"`);
  }
  if (!columnDescriptor.nullable) {
    components.push("not null");
  }
  return components.join(" ");
};
