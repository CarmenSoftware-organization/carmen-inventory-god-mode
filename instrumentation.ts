/**
 * Next.js instrumentation hook — รันครั้งเดียวตอน server เริ่ม ก่อน request แรก
 *
 * นี่คือจุดเดียวที่ Next.js รับประกันว่าทำงานก่อนโค้ดอื่น จึงเป็นที่เดียวที่
 * ตั้ง OTel ได้ทัน (instrumentation ต้อง patch โมดูลก่อนถูก import)
 */
export async function register(): Promise<void> {
  // ไม่ตั้งใน edge runtime — SDK ของ Node ใช้ไม่ได้ที่นั่น
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTelemetry } = await import("@/lib/telemetry");
  const { version } = await import("@/package.json");
  const on = startTelemetry(String(version ?? "0.0.0"));
  if (on) console.log("[otel] telemetry enabled for god-mode");
}
