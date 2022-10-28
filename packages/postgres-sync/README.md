# Overview

Use Dataland as an admin panel into your Postgres data. This module replicates specified tables from your Postgres database into Dataland on a recurring every 30 seconds cadence.

Any changes done in the Dataland UI against the specified tables will execute a transaction that writes back to your Postgres. Dataland always treats your Postgres instance as the source of truth. Any invalid transactions attempted from Dataland will be rejected by your source Postgres.

Data in the Dataland UI will be re-updated every 30 seconds by default.

## Parameter setup

| Name               | About                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `pg-host`          | Database host                                                                                    |
| `pg-port`          | Database port                                                                                    |
| `pg-database`      | Database name                                                                                    |
| `pg-user`          | Database user                                                                                    |
| `pg-password`      | Database password                                                                                |
| `pg-schema`        | Database schema                                                                                  |
| `pg-table-mapping` | The list of synced tables from Postgres. See below for format details.                           |
| `pg-do-writeback`  | A boolean value. If `true`, then writeback is enabled. If `false`, then no writeback is allowed. |

### Inputting `pg-table-mapping`

This parameter is JSON that specifies the mapping between the synced tables from Postg resand the Dataland tables they will sync into.

The JSON follows the format:

```json
{
  "pg_table_name_1": "dataland_table_name_1",
  "pg_table_name_2": "dataland_table_name_2"
  // and so on
}
```

For example, let's say we want to sync three tables from Postgres database into Dataland. In Postgres, the desired tables are titled `Customers`, `Orders`, and `Products`. We want to sync them into Dataland with the names `synced_customers`, `synced_orders`, and `synced_products` respectively. The resulting JSON would be:

```json
{
  "Customers": "synced_customers",
  "Orders": "synced_orders",
  "Products": "synced_products"
}
```

The stringified version of this JSON can then used as the `pg-table-mapping` module installation form:

```
'{"Customers":"synced_customers","Orders":"synced_orders","Products":"synced_products"}'
```

Or, in the .env file:

```env
DL_PARAM_PG_TABLE_MAPPING='{"Customers":"synced_customers","Orders":"synced_orders","Products":"synced_products"}'
```
