# الدرس 1: Elasticsearch

## المصطلحات

| المصطلح | المعنى | المثال |
|---|---|---|
| **Elasticsearch** | قاعدة بيانات مخصصة للبحث السريع في كميات كبيرة من النصوص والـ JSON | تخزين ملايين الـ logs والبحث فيها خلال أجزاء من الثانية |
| **Document** | سجل واحد بصيغة JSON (مثل الصف في SQL) | `{"level":"error","message":"payment failed"}` |
| **Index** | مجموعة من الـ documents المتشابهة (مثل الجدول في SQL) | `app-logs` |
| **Node / Cluster** | الـ node سيرفر واحد يشغل Elasticsearch، والـ cluster مجموعة nodes | نحن نستخدم node واحد (`single-node`) |
| **REST API** | نتعامل مع Elasticsearch بطلبات HTTP عادية | `GET /app-logs/_search` |

**لماذا Elasticsearch للـ logs؟** لأن الـ logs كثيرة جداً، ونحتاج أن نبحث فيها بالنص ("كل الأخطاء التي فيها كلمة payment في آخر ساعة"). قواعد البيانات العادية بطيئة في هذا النوع من البحث.

**مقارنة مع SQL:**

```
SQL:            Database -> Table  -> Row
Elasticsearch:  Cluster  -> Index  -> Document
```

## الكود

### 1. شغل Elasticsearch

```bash
cd 01-elk-logs
docker compose up -d
docker compose ps        # انتظر حتى تصبح الحالة healthy (حوالي 30 ثانية)
```

### 2. تأكد أنه يعمل

```bash
curl http://localhost:9200
```

النتيجة: JSON فيه `"tagline" : "You Know, for Search"`.

### 3. أضف أول document

```bash
curl -X POST http://localhost:9200/app-logs/_doc \
  -H 'Content-Type: application/json' \
  -d '{"@timestamp":"2026-10-25T10:00:00Z","level":"info","service":"orders","message":"order created"}'

curl -X POST http://localhost:9200/app-logs/_doc \
  -H 'Content-Type: application/json' \
  -d '{"@timestamp":"2026-10-25T10:01:00Z","level":"error","service":"payments","message":"payment failed: card declined"}'
```

لاحظ أننا لم ننشئ الـ index `app-logs` مسبقاً. Elasticsearch أنشأه تلقائياً مع أول document.

### 4. ابحث

```bash
# كل الـ documents
curl "http://localhost:9200/app-logs/_search?pretty"

# فقط الأخطاء
curl -X GET "http://localhost:9200/app-logs/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"level":"error"}}}'

# بحث نصي: أي log فيه كلمة "payment"
curl "http://localhost:9200/app-logs/_search?q=message:payment&pretty"
```

### 5. شاهد الـ mapping

```bash
curl "http://localhost:9200/app-logs/_mapping?pretty"
```

**Mapping** يعني نوع كل حقل (`text` أو `keyword` أو `date`...). Elasticsearch خمنه تلقائياً، وسنتعلم لاحقاً كيف نحدده بأنفسنا.

## تمرين

1. أضف 3 logs جديدة من service اسمها `users`.
2. ابحث عن كل الـ logs التابعة لـ `users`.
3. احذف الـ index بالكامل: `curl -X DELETE http://localhost:9200/app-logs`

## إيقاف التشغيل

```bash
docker compose down        # يوقف الـ containers ويحتفظ بالبيانات
docker compose down -v     # يوقف ويحذف البيانات أيضاً
```
