/**
 * OpenTelemetry ของ god-mode — ส่ง trace/log/metric ไป SigNoz
 *
 * **ตั้งเป้าต่ำโดยตั้งใจ** — repo นี้รันด้วย `bun next dev` และ auto-instrumentation
 * ของ Node พึ่งการ hook `require` ซึ่ง Bun รองรับไม่ครบ SDK อาจ start ผ่านแต่ไม่
 * ได้ span เลย สิ่งที่**รับประกัน**ว่าได้คือ log ของทุก operation ที่ถูก audit
 * (`writeAudit`) ซึ่งไม่พึ่งกลไก patch ใด ๆ ถ้า auto-instrumentation ทำงานด้วย
 * ถือเป็นกำไร ไม่ใช่เงื่อนไขความสำเร็จ
 *
 * ไม่ตั้ง `OTEL_EXPORTER_OTLP_ENDPOINT` = ไม่ start อะไรเลย
 */
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { context } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = "god-mode";
const LOGGER_NAME = "carmen.god-mode";

let started = false;
let loggerProvider: LoggerProvider | undefined;

export function isTelemetryEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

export function startTelemetry(version: string): boolean {
  if (started) return loggerProvider !== undefined;
  started = true;
  if (!isTelemetryEnabled()) return false;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: version,
    "service.namespace": "carmen",
    // คีย์ชื่อเดิม ไม่ใช่ deployment.environment.name ของ semconv ล่าสุด —
    // SigNoz index ตัวนี้
    "deployment.environment": process.env.DEPLOYMENT_ENVIRONMENT ?? "dev",
  });

  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();

  const shutdown = async (): Promise<void> => {
    // flush ก่อนตาย — ไม่มีขั้นนี้ log ช่วงก่อนปิดหายทุกครั้งที่ restart
    await Promise.allSettled([loggerProvider?.forceFlush()]);
    await Promise.allSettled([loggerProvider?.shutdown(), sdk.shutdown()]);
  };
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
  return true;
}

/**
 * บันทึกทุก operation ที่ถูก audit ขึ้น SigNoz
 *
 * เสียบที่ `writeAudit` จุดเดียวเพราะมันเป็นทางผ่านเดียวของทุกการกระทำที่
 * เปลี่ยนข้อมูล (INSERT/UPDATE/DELETE/CASCADE_DELETE/DROP_SCHEMA/RAW_SQL/
 * SOFT_DELETE/RESTORE/MIGRATION) — เสียบทีเดียวครอบทั้ง 8+ call site
 *
 * **ไม่ส่ง oldValues/newValues** — เนื้อข้อมูลจริงของตารางอาจมีอะไรก็ได้ และ
 * SigNoz เก็บไว้เป็นวัน ๆ ให้ใครที่เข้า UI ได้อ่านหมด ตาราง audit ในฐานข้อมูล
 * ยังเก็บของครบเหมือนเดิม ที่นี่เอาแค่ "ใครทำอะไรกับอะไร" พอ
 *
 * ห้าม throw เด็ดขาด — audit ที่ล้มเพราะ telemetry คือการทำลายบันทึกที่เป็น
 * ทางกู้คืนทางเดียวของ repo นี้
 */
export function recordAuditEvent(e: {
  actor: string;
  schemaName: string;
  tableName: string | null;
  operation: string;
  statement: string | null;
}): void {
  if (!loggerProvider) return;
  try {
    logs.getLogger(LOGGER_NAME).emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: `god-mode ${e.operation} on ${e.schemaName}${e.tableName ? `.${e.tableName}` : ""}`,
      attributes: {
        "carmen.actor": e.actor,
        "carmen.schema": e.schemaName,
        "carmen.table": e.tableName ?? "",
        "carmen.operation": e.operation,
        ...(e.statement ? { "carmen.statement": e.statement.slice(0, 2000) } : {}),
      },
      context: context.active(),
    });
  } catch {
    // เงียบเสมอ
  }
}
