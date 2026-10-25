# المرحلة 0: تجهيز المشروع ومفاهيم أساسية

## 1. Observability (قابلية المراقبة)

**المصطلح:** Observability

**المعنى:** قدرتك على فهم ما يحدث داخل النظام من الخارج، فقط من البيانات التي يرسلها، بدون أن تفتح الكود أو تضيف `console.log` جديد كل مرة.

**المثال:** المستخدم يقول "الدفع بطيء". بدون observability تخمن السبب. معها تفتح Kibana وترى أن طلب `/payments` أخذ 4 ثوانٍ، منها 3.5 ثانية في استعلام قاعدة البيانات.

## 2. الأعمدة الثلاثة (Three Pillars)

| المصطلح | المعنى | مثال |
|---|---|---|
| **Logs** | سطر نصي أو JSON يصف حدثاً حصل في وقت معين | `{"level":"error","msg":"payment failed","userId":42}` |
| **Metrics** | أرقام تُقاس على مدى الوقت | عدد الطلبات في الثانية، استهلاك الذاكرة |
| **Traces** | رحلة طلب واحد عبر كل الخدمات، مقسمة إلى spans | طلب `/checkout` مر على `orders` ثم `payments` ثم قاعدة البيانات |

## 3. أين يدخل ELK و OpenTelemetry؟

- **OpenTelemetry (OTel):** معيار مفتوح ومجموعة أدوات لـ **جمع** الـ logs والـ metrics والـ traces من تطبيقك بطريقة موحدة.
- **ELK:** مكان **تخزين** البيانات والبحث فيها وعرضها:
  - **Elasticsearch**: قاعدة بيانات للبحث والتخزين.
  - **Logstash**: يستقبل البيانات ويعالجها ويرسلها إلى Elasticsearch.
  - **Kibana**: واجهة لعرض البيانات والبحث فيها وبناء dashboards.

```
NestJS app ──(logs/traces/metrics)──> OTel / Logstash ──> Elasticsearch ──> Kibana
```

## 4. الكود: تجهيز المجلد على جهازك

```bash
cd ~/developer/NodeJsStudioProjects
git clone https://github.com/Hassank455/elk-otel-learning.git
cd elk-otel-learning
```

تأكد من الأدوات:

```bash
node -v            # 20 أو أحدث
docker -v
docker compose version
```
