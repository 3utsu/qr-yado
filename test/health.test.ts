import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("最小構成", () => {
  it("/health が ok を返す", async () => {
    const res = await app.request("/health", {}, { APP_ENV: "test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "test" });
  });

  it("トップページが日本語で表示される", async () => {
    const res = await app.request("/", {}, { APP_ENV: "test" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("遍路宿");
  });
});
