import { openDarDatabase } from "@/lib/dar-database";

export const runtime = "nodejs";

export async function GET() {
  let database: ReturnType<typeof openDarDatabase> | undefined;
  try {
    database = openDarDatabase();
    const rates = database.prepare(
      "SELECT * FROM basic_rates ORDER BY CAST(code AS INTEGER), code, category",
    ).all();
    return Response.json(rates);
  } catch (error) {
    console.error("Could not read basic rates from the DAR database:", error);
    return Response.json({ error: "Could not load basic rates from the DAR database." }, { status: 500 });
  } finally {
    database?.close();
  }
}
