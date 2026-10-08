import { openDarDatabase } from "@/lib/dar-database";

export const runtime = "nodejs";

function getParentCodes(itemCode: string) {
  const codes: string[] = [];
  let parent = itemCode;
  while (parent.includes(".")) {
    parent = parent.slice(0, parent.lastIndexOf("."));
    codes.push(parent);
  }
  return codes;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("itemCodes" in body) ||
    !Array.isArray(body.itemCodes) ||
    body.itemCodes.length > 5000 ||
    !body.itemCodes.every((code) => typeof code === "string" && code.trim().length > 0)
  ) {
    return Response.json({ error: "itemCodes must be an array of at most 5000 non-empty strings." }, { status: 400 });
  }

  const itemCodes = [...new Set(body.itemCodes.map((code) => code.trim()))];
  let database: ReturnType<typeof openDarDatabase> | undefined;
  try {
    database = openDarDatabase();
    const selectComponents = database.prepare(
      "SELECT * FROM item_components WHERE item_code = ? ORDER BY COALESCE(component_seq, item_component_id), item_component_id",
    );
    const selectDarItem = database.prepare("SELECT * FROM dar_items WHERE item_code = ?");
    const selectSubAnalysis = database.prepare("SELECT * FROM sub_analyses WHERE analysis_code = ?");
    const selectSubComponents = database.prepare(
      "SELECT * FROM sub_analysis_components WHERE analysis_code = ? ORDER BY COALESCE(component_seq, sub_analysis_component_id), sub_analysis_component_id",
    );
    const analyses = Object.fromEntries(itemCodes.map((itemCode) => {
      const darItem = selectDarItem.get(itemCode) || null;
      let components = selectComponents.all(itemCode);
      let sourceItemCode = itemCode;
      if (components.length === 0) {
        for (const parentCode of getParentCodes(itemCode)) {
          const parentComponents = selectComponents.all(parentCode);
          if (parentComponents.length > 0) {
            components = parentComponents;
            sourceItemCode = parentCode;
            break;
          }
        }
      }

      const subAnalysis = selectSubAnalysis.get(itemCode) || null;
      return [itemCode, {
        darItem,
        sourceItemCode,
        components,
        subAnalysis,
        subComponents: subAnalysis ? selectSubComponents.all(itemCode) : [],
      }];
    }));
    const allSubAnalyses = database.prepare("SELECT * FROM sub_analyses").all();
    const allSubComponents = database.prepare(
      "SELECT * FROM sub_analysis_components ORDER BY analysis_code, COALESCE(component_seq, sub_analysis_component_id), sub_analysis_component_id",
    ).all();
    return Response.json({ analyses, allSubAnalyses, allSubComponents });
  } catch (error) {
    console.error("Could not read item components from the DAR database:", error);
    return Response.json({ error: "Could not load rate analyses from the DAR database." }, { status: 500 });
  } finally {
    database?.close();
  }
}
