import { DatabaseSync } from "node:sqlite";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  compile() {
    const indexes = [];
    let highestIndex = 0;
    const sql = this.sql.replace(/\?(\d+)?/g, (_match, rawIndex) => {
      let parameterIndex;

      if (rawIndex) {
        parameterIndex = Number(rawIndex);
        highestIndex = Math.max(highestIndex, parameterIndex);
      } else {
        highestIndex += 1;
        parameterIndex = highestIndex;
      }

      indexes.push(parameterIndex - 1);
      return "?";
    });
    const values = indexes.length ? indexes.map((index) => this.values[index]) : this.values;
    return { sql, values };
  }

  first() {
    const { sql, values } = this.compile();
    const row = this.database.prepare(sql).get(...values);
    return row ? { ...row } : null;
  }

  all() {
    const { sql, values } = this.compile();
    return { results: this.database.prepare(sql).all(...values).map((row) => ({ ...row })) };
  }

  run() {
    const { sql, values } = this.compile();
    const result = this.database.prepare(sql).run(...values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class TestD1 {
  constructor(schema = "") {
    this.database = new DatabaseSync(":memory:");

    if (schema) {
      this.database.exec(schema);
    }
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  batch(statements) {
    this.database.exec("BEGIN");

    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    this.database.exec(sql);
  }

  close() {
    this.database.close();
  }
}

export { TestD1 };
