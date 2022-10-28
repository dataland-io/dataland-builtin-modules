import { registerTransactionHandler } from "@dataland-io/dataland-sdk";
import { translateTransaction } from "./translate";
import { getClient, getPgSchema } from "./utils";

registerTransactionHandler(async (transaction) => {
  const t0 = performance.now();

  const pgSchema = getPgSchema();

  // TODO(hzuo): Don't re-connect for each new transaction
  const client = getClient();
  await client.connect();

  const t1 = performance.now();

  try {
    const t2 = performance.now();

    const writes = translateTransaction(transaction, pgSchema);

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

    const tx = client.createTransaction(transaction.transactionId);
    await tx.begin();
    for (const write of writes) {
      const [query, params] = write;
      try {
        await tx.queryArray(query, params);
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
    await tx.commit();

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
    await client.end();
  }
});
