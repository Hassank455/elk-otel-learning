# elk-otel-learning

رحلة تعلم خطوة بخطوة لـ **ELK Stack** (Elasticsearch, Logstash, Kibana) و **OpenTelemetry** باستخدام **NestJS** و **Docker**.

Step-by-step learning journey for the ELK Stack and OpenTelemetry with NestJS: logs, traces, metrics, and Docker.

## طريقة العمل في كل خطوة

1. **المصطلح**: ما اسم الشيء الذي نتعلمه؟
2. **المعنى**: ماذا يعني ولماذا نحتاجه؟
3. **المثال**: مثال بسيط من الحياة أو من مشروع حقيقي.
4. **الكود**: نكتب الكود ونشغله ونتأكد أنه يعمل.

كل خطوة لها ملف شرح داخل مجلد `docs/`، وكود داخل مجلد المرحلة.

## المراحل

| المرحلة | المجلد | الموضوع | الحالة |
|---|---|---|---|
| 0 | `docs/00-setup.md` | تجهيز المشروع ومفاهيم Observability الأساسية | ✅ |
| 1 | `01-elk-logs/` | تشغيل ELK بـ Docker، وتطبيق NestJS يرسل structured logs، والبحث في Kibana وأول dashboard | ⏳ |
| 2 | `02-opentelemetry/` | traces و spans و metrics و context propagation، و OTel SDK و OTel Collector و Elastic APM | ⏳ |
| 3 | `03-full-observability/` | خدمتين NestJS، و distributed tracing، وربط الـ logs بالـ traces عن طريق trace_id، و alerts | ⏳ |
| 4 | `04-advanced/` | sampling و index lifecycle وتجهيز الإعداد للـ production (اختياري) | ⏳ |

## المتطلبات

- Node.js 20+
- Docker و Docker Compose
- NestJS CLI: `npm i -g @nestjs/cli`

## سجل التعلم

| التاريخ | الخطوة | ملاحظات |
|---|---|---|
| 2026-10-25 | المرحلة 0 | إنشاء الـ repo والخطة |
