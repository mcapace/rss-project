import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMorwebCli } from "../../../../scripts/import-morweb";

let directory: string;
let input: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "morweb-cli-test-"));
  input = join(directory, "input.json");
  writeFileSync(input, JSON.stringify({ Posts: { "901": {
    id: "901", title: "Synthetic import", content: "<p>Synthetic body.</p>", alias: "synthetic-import",
    category_selected: ["18"], category: "News", published: "0", published_flag: "0", published_class: "", published_switch: 1,
  } } }));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

async function run(extra: string[], env: Record<string, string> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let status = 0;
  try {
    await runMorwebCli(["--input", input, ...extra], { env: { NODE_ENV: "test", ...env }, log: message => stdout.push(message), progress: message => stderr.push(message) });
  } catch (error) {
    status = 1;
    stderr.push(error instanceof Error ? error.message : "Import failed.");
  }
  return { status, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

describe("Morweb development CLI boundaries", () => {
  it("runs offline by default, without database credentials", async () => {
    const result = await run([]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "dry-run", eligible_records: 1, target_write_performed: false });
  });

  it("refuses to overwrite its input with a report", async () => {
    const original = readFileSync(input, "utf8");
    const result = await run(["--report", input]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not overwrite an input");
    expect(readFileSync(input, "utf8")).toBe(original);
  });

  it("requires an explicitly matching development target before any database call", async () => {
    const result = await run(["--apply", "--report", join(directory, "report.json"), "--development-target", "wrong.example.test"], {
      CMS_IMPORT_SUPABASE_URL: "https://development.example.test", CMS_IMPORT_SERVICE_ROLE_KEY: "synthetic-key-never-sent",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must explicitly match");
    expect(result.stderr).not.toContain("synthetic-key-never-sent");
  });

  it("does not echo private content when JSON parsing fails", async () => {
    writeFileSync(input, '{"private": this-is-private-source-content }');
    const result = await run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not valid JSON");
    expect(result.stderr).not.toContain("this-is-private-source-content");
  });
});
