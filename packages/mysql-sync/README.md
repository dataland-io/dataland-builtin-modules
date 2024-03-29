# Overview

Use Dataland as an admin panel into your MySQL data. This module replicates specified tables from your MySQL database into Dataland on a recurring every 30 seconds cadence.

Any changes done in the Dataland UI against the specified tables will execute a transaction that writes back to your MySQL. Dataland always treats your MySQL instance as the source of truth. Any invalid transactions attempted from Dataland will be rejected by your source MySQL.

Data in the Dataland UI will be re-updated every 30 seconds by default.

## Parameter setup

| Name                  | About                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `mysql-host`          | Database host                                                                                    |
| `mysql-port`          | Database port                                                                                    |
| `mysql-user`          | Database user                                                                                    |
| `mysql-password`      | Database password                                                                                |
| `mysql-db`            | Database name                                                                                    |
| `mysql-table-mapping` | The list of synced tables from MySQL. See below for format details.                              |
| `mysql-do-writeback`  | A boolean value. If `true`, then writeback is enabled. If `false`, then no writeback is allowed. |

### Inputting `mysql-table-mapping`

This parameter is JSON that specifies the mapping between the synced tables from MySQL and the Dataland tables they will sync into.

The JSON follows the format:

```json
{
  "mysql_table_name_1": "dataland_table_name_1",
  "mysql_table_name_2": "dataland_table_name_2"
  // and so on
}
```

For example, let's say we want to sync three tables from MySQL database into Dataland. In MySQL, the desired tables are titled `Customers`, `Orders`, and `Products`. We want to sync them into Dataland with the names `synced_customers`, `synced_orders`, and `synced_products` respectively. The resulting JSON would be:

```json
{
  "Customers": "synced_customers",
  "Orders": "synced_orders",
  "Products": "synced_products"
}
```

The stringified version of this JSON can then used as the `mysql-table-mapping` module installation form:

```
'{"Customers":"synced_customers","Orders":"synced_orders","Products":"synced_products"}'
```

Or, in the .env file:

```env
DL_PARAM_MYSQL_TABLE_MAPPING='{"Customers":"synced_customers","Orders":"synced_orders","Products":"synced_products"}'
```
