import Database from "better-sqlite3";
import path from "node:path";

export function openDarDatabase() {
  return new Database(path.join(process.cwd(), "CPWD_DAR_2023_Master.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
}
