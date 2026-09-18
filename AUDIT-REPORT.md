# 🔍 تقرير التدقيق الشامل — Zeruvo AI
**التاريخ:** 17 سبتمبر 2026 · **النطاق:** المشروع كامل (web + gateway-worker + supabase + scripts) · **بدون أي تعديلات على الكود**

> منهجية: 12 مدقق متوازي (كل واحد قرأ الكود الفعلي بمراجع file:line) + تحقق خصومي (كل ثغرة/باج حاول 2-3 مدققين مستقلين نفيها — اللي عاش هو المؤكد) + تحقق يدوي مني للأهم بعد توقف الورك فلو. **181 نتيجة خام → 56 مؤكدة، 3 مرفوضة، الباقي ملاحظات جودة.**

---

## 1) الملخص التنفيذي

المشروع **سليم معمارياً في مواضع كتير** (تشفير مفاتيح المزودين AES-GCM، توقيع Kashier HMAC بتوقيت-ثابت، RLS على كل الجداول الـ20، حماية صاعدة للـadmin functions) — لكن فيه **ثغرة حرجة واحدة مفتوحة الآن على الإنتاج** و**مجموعة ثغرات حقيقية** كلها بتلمس نفس الثلاث نقاط: **الفلوس، الكوتا، وباب API**.

**أخطر 5 مخاطر (بالترتيب):**

| # | الثغرة | الخطورة |
|---|--------|---------|
| 1 | أي زائر مجهول يقدر يمنح أي حساب اشتراك مدفوع (اتأكدت لايف: 409 FK مش 403!) | 🔴 CRITICAL |
| 2 | لا يوجد حد أقصى لحجم الجسم + JSON.parse قبل المصادقة → نفس عائلية exceededCpu يمكن استغلالها كـ DoS | 🟠 HIGH |
| 3 | rate_limit_per_min محفوظ ويرجع من الـauth ومش متنفذ في أي مكان | 🟠 HIGH |
| 4 | بوابة عمر حساب GitHub قابلة للتزوير من المتصفح + pending حالة كلينت-سايد فقط | 🟠 HIGH |
| 5 | الدفع في وضع test بيفعّل اشتراكات حقيقية + الكوبونات تُستخدم بلا حدود لكل مستخدم | 🟠 HIGH |

**أسرع المكاسب:** إصلاح سياسة subscriptions (سطر واحد SQL)، حجب egp_rate للعامة أو جلب السعر من السيرفر، رفض Bodies > 2MB قبل parse، ووضع error boundary.

---

## 2) الثغرات الأمنية المؤكدة (بعد التحقق الخصومي)

### 🔴 CRITICAL — اتأكدت لايف بالبروبنج

#### C1. أي شخص مجهول يمنح أي حساب اشتراك مدفوع — تجاوز كامل للدفع
- **الموقع:** [20260826150000_rls_hardening.sql:32-38](supabase/migrations/20260826150000_rls_hardening.sql)
- **الدليل (اتأكدت بنفسي الآن):** السياسة بتسمح `or auth.uid() is null` — وده متحقق لكل طلب PostgREST بدون JWT. بروبنج لايف بـanon key على subscriptions أرجع **409 (FK violation)** مش 403/401 — يعني RLS **عدّى الطلب** ووصل لفحص المفاتيح الأجنبية. طلب حقيقي بـ`user_id` و`plan_id` صحيحين هيرجع **201** ويشتغل فوراً.
- **السيراريو:** `POST /rest/v1/subscriptions` بمفتاح الأنون من موقعك المنشور + أي user_id + أي خطة مدفوعة + `expires_at: 2999-01-01` → صلاحيات مدفوعة كاملة مجاناً (وبالتالي كوتا الـ1M المجانية بتتجاوز لخطط أغلى).
- **الإصلاح:** احذف فرع null-uid: `with check (public.is_admin())`. الـservice_role بيتجاوز RLS أصلاً فمش محتاجه. وبعدها `REVOKE INSERT/UPDATE/DELETE ON subscriptions FROM anon, authenticated`.

### 🟠 HIGH

#### H1. لا يوجد حد لحجم الجسم + JSON.parse قبل المصادقة (DoS / exceededCpu)
- **الموقع:** [index.ts:150](gateway-worker/src/index.ts:150) — `request.json()` قبل auth عند سطر 161؛ 3 تمريرات كاملة على بايتات المهاجم (`quota.ts:23` + `index.ts:428`).
- **السيراريو:** جسم 100MB (حد Cloudflare) = buffer كامل في الميموري + stringify ×3 → استهلاك CPU غالي قبل أي مصادقة. ده نفس نوع ضغط الـCPU اللي قفلت الوركر قبل كده — دايم طلوع.
- **الإصلاح:** `Content-Length > ~2MB` → رفض فوري قبل أي parse؛ قراءة تدريجية بسقف بايت صلب؛ انقل parse بعد الـauth.

#### H2. rate_limit_per_min: مخزّن، مرجَع من auth… ومش متنفذ أبداً
- **الموقع:** [auth.ts:17](gateway-worker/src/auth.ts:17) + grep على gateway-worker/src كله = صفر استخدامات أخرى.
- **السيراريو:** حساب واحد يضرب الـgateway بآلاف الطلبات/دقيقة — الحاجز الوحيد هو كوتا اليومي.
- **الإصلاح:** Durable Object أو Rate Limiting binding keyed بـ`api_key_id` قبل reserve().

#### H3. بوابة عمر حساب GitHub: التاريخ بيتكتب من المتصفح وقابل للتعديل
- **الموقع:** [auth-context.tsx:51](web/src/auth-context.tsx:51) — المتصفح نفسه بيكتب `github_created_at`؛ سياسة self-update مش بتثبت العمود ([20260826180000:14-22](supabase/migrations/20260826180000_fix_profile_escalation.sql)).
- **السيراريو:** `PATCH /rest/v1/profiles {"github_created_at":"2005-01-01"}` → تجاوز بوابة الحد الأدنى لعمر الحساب → حصاد كوتا الـfree بحسابات GitHub مهملة.
- **الإصلاح:** امسك التاريخ server-side (Auth hook/edge function بـservice role) + ثبّت العمود في سياسة self-update والـtrigger + طبّق البوابة في `auth_key_lookup` نفسها.

#### H4. الحالة pending (تحت العمر) متنفذة في React فقط
- **الموقع:** [guards.tsx:43-52](web/src/routes/guards.tsx)؛ `auth_key_lookup` مفيهوش أي فحص عمر؛ checkout بيتحقق من تسجيل الدخول فقط.
- **السيراريو:** يوزر pending يعمل مفتاح API بـcurl (RLS بيسمح) ويستدعي api.zeruvo.online عادي — ويسدد خطط وهو pending.
- **الإصلاح:** خلي البوابة حيث الفلوس والكوتا: في `auth_key_lookup` + checkout.

#### H5. كوبون بلا حد لكل مستخدم — checkout عمره ما بيتحقق من الاستخدامات السابقة
- **الموقع:** [checkout/index.ts:97-116](supabase/functions/checkout/index.ts) (بيفحص النافذة والعدد الكلي فقط)؛ PK على `coupon_redemptions(coupon_code, user_id)` بيوحي بقصد "مرة لكل مستخدم" مش متنفذ؛ الـwebhook بيبلع خطأ التكرار وبعدين **يزود العداد برضه** ([kashier-webhook:161-169](supabase/functions/kashier-webhook/index.ts)).
- **السيراريو:** حساب واحد يستهلك ميزانية `max_redemptions` كاملة لوحده.
- **الإصلاح:** في checkout ااستعلم `coupon_redemptions` للـ(code, user) وارفض التكرار؛ عدّاد الزيادة بس لما الإدراج ينجح فعلاً (يعني RPC ذري).

#### H6. الدفع بوضع test بيفعّل اشتراكات حقيقية
- **الموقع:** [kashier-webhook/index.ts:95-130](supabase/functions/kashier-webhook/index.ts) — مسار النجاح **بيقرأ meta.plan_id وmeta.renew لكن عمره ما بيقرأ meta.mode** (اتأكدت بالقراءة)؛ checkout بيخزن `mode: gw.mode` ([checkout:167](supabase/functions/checkout/index.ts)).
- **السيراريو:** Gateway معلّم enabled وtest (توجّلين مستقلين في Gateways.tsx) → أي مسجل دخول يدفع بكارت Kashier التجريبي العام → اشتراك مدفوع حقيقي بصفر إيراد.
- **الإصلاح:** الـwebhook يطلب `meta.mode === 'live'` قبل التفعيل؛ وارفض إنشاء checkout URLs لبوابة test في الإنتاج.

#### H7. شهادة EGP الظاهرة ≠ المبلغ المتحصّل
- **الموقع:** [PlansBrowser.tsx:50](web/src/pages/user/PlansBrowser.tsx) `useState(50)` + سياسة `payment_gateways: admin read` تمنع غير الأدمن → سعر الصر للمستخدم دايماً 50؛ التحصيل الفعلي بيجي من `gw.egp_rate` الحقيقي ([checkout:122-123](supabase/functions/checkout/index.ts)).
- **السيراريو:** الأدمن يغيّر السعر لـ52 → كل الزباير شايفين 50 والمتحصّل فعلاً 52 → عيب إفصاح فاتورة لكل عميل.
- **الإصلاح:** خلي `egp_rate` عام (GRANT SELECT للأعمدة غير السرية + policy عامة) أو رجّع السعر من checkout نفسه.

#### H8. أسرار الإنتاج في ملف واحد + `.dev.vars` مش متجاهَل في repo عام
- **الموقع:** [`.env.local:2-11`](.env.local) — service-role + Management token + DEK في ملف واحد؛ `.gitignore` بيقفل `.env*` لكن **`.dev.vars` مش مذكور** و`gateway-worker/.dev.vars` موجود فعلاً. التاريخ النظيف اتأكد (0 تسريب في 68 commit) لكن الخطر مستقبلي.
- **الإصلاح:** `.gitignore` += `.dev.vars` و`.wrangler/`؛ قسّم env لكل مصرفي؛ فعّل secret-scanning على GitHub.

#### H9. DEK واحد لكل حاجة وبلا أدوات تدوير
- **الموقع:** [wrangler.toml:22-24](gateway-worker/wrangler.toml) + 6 دوال edge — مفتاح واحد يشفّر مفاتيح المزودين **و** اعتمادات Kashier. لو اتنفض: إعادة تشفير يدوية صعبة.
- **الإصلاح:** سكربت `rotate-dek.mjs` (فك تشفير كل الـblobs → إعادة تشفير → تحديث السريت) + runbook.

---

### 🟡 MEDIUM (مؤكدة — ملخص)
| الثغرة | الموقع |
|--------|--------|
| جدول `providers` كله (روابط upstream) مقروء للأنونيم → كشف المزودين اللي بتخفيهم بالتصميم | phase1_schema RLS |
| `models` بتكشف `upstream_model_id` والصفوف المعطّلة للأنونيم | phase1_schema RLS |
| حظر يوزر مش بيسحب مفاتيحه — المanned بيفضل شغال في الـgateway لحد انتهاء اشتراكه | admin-users:96-101 |
| CORS: preflight بيرجع `*` لكن الردود الفعلية مفيهاش `Access-Control-Allow-Origin` — تناقض بيكسر بعض العملاء | index.ts |
| نص أخطاء المزوّد بيتسرب للعميل لما كل المفاتيح تفشل → يكشف أسماء المزودين المخفية | failover.ts error frames |
| مفيش CSP/frame-ancestors/Referrer-Policy على الـSPA | vercel.json |
| معدل كلمات السر 6 حروف على API (8 في UI) + مفيش MFA للأدمن | config.toml:182-185 |
| توكنات كاملة في كوكيز غير httpOnly (400 يوم) بلا session timebox | @supabase/ssr defaults |
| التلاعب بـ`rate_limit_per_min` و`allowed_models` و`status` للمفتاح من صاحبه + إعادة تنشيط مفتاح admin-revoked | phase1_schema:258-260 |
| كوبونات مقروءة مجهول المصدر — enumerable بالكامل | coupons RLS |

---

## 3) الباجات المؤكدة (الأعلى أثراً)

| الباج | الموقع | الأثر |
|-------|--------|------|
| **حجوزات كوتا معلقة بلا sweeper أو retry للـsettle** — لو blip بعد reserve: الحجز مش بيتحرر لحد منتصف الليل UTC | [quota.ts:62-91](gateway-worker/src/quota.ts), db.ts:40 | يوزر بيتحجب 20% من كوتته ببلاش |
| **CAP_FRACTION=0.2 + تزامن** — 5 طلبات ضخمة متزامنة كلهم بيعديوا الـgate وبعدين overdraw عند settle | [quota.ts:51-59](gateway-worker/src/quota.ts:51) | سحب كوتا زيادة بلا تحكم |
| **Aggregate (stream:false) لسه بيعمل JSON.parse ×2-3 لكل frame** — sniffError عند [stream.ts:199](gateway-worker/src/stream.ts:199) لكل frame + assembleResponse بتعيد parse الكل ([stream.ts:322](gateway-worker/src/stream.ts:322)) — **نفس عائلية exceededCpu لسه قايمة على المسار التجميعي** | stream.ts | خطر رجوع "Response ended unexpectedly" على stream:false |
| **مفيش React ErrorBoundary** — أي exception = شاشة بيضا | main.tsx | سقوط كامل للواجهة |
| **3 أنظمة i18n متوازية** — fr/zh شايفين الإنجليزية في التسويق (45 ternary مباشرة) | HomeNew إلخ | جودة الترجمة الفرنسية/الصينية = صفر فعلياً |
| **رسوم console وadmin (~2800 سطر) إنجليزي hardcoded** | user/admin pages | العربي مش موجود في الـconsole |
| **إشعارات الاستخدام صفر** — لا تحذير 80% كوتا، لا تنبيه انتهاء اشتراك، لا إيميل استلام دفع | UX | اكتشاف الانتهاء بعد الفشل |
| **صفحة Purchases موجودة ومش في السايدبار** | DashboardShell | ميزة مخفية عن اليوزر |
| **README/AGENTS.md بيقولوا Next.js** ومشروع Next اتشال يوم 26 أغسطس | AGENTS.md | أي AI agent هيتضيع |
| **الكوتا اليومية لينة** ضد الطلبات المتزامنة الكبيرة (نفس CAP_FRACTION) | quota.ts | استهلاك غير متوقع |
| **تقدير التوكنات بيتجاهل system prompt وtools** → under-billing لو usage مش مرجع | quota.ts:23 | إيراد أقل من المتوقع |

**ملاحظات أخيرة:** النواقص دي في gateway-worker ليها نفس النمط — **مسار aggregate مش معالَج بآداء نفس مستوى المسار streaming** — وهجعل أولويتك فوراً.

---

## 4) ملاحظات معلقة على تحقق جزئي (من الدومينات اللي الورك فلو اتوقف فيها — قريت الأدلة بنفسي واتأكدت من الأهم، والباقي محتاج تصديق لاحق)

- 🔴 **تأكيد دستوري بعد الفحص اليدوي:** حذف الحساب — الـPrivacy policy بتوعد "يمكنك حذف حسابك من إعدادات اللوحة" — **الميزة مش موجودة إطلاقاً** (Settings.tsx فيه لغة + باسورد فقط) + **صفحة Terms of Service مش موجودة خالص** لمنتج مدفوع.
- 🟠 حجز/إلغاء التزامن في الـwebhook (TOCTOU): دفع مزدوج ممكن يعمل اشتراكين.
- 🟠 سكربت `test-kashier-webhook.mjs` **بيكتب فوق بيانات الـgateway الحقيقية ومش بيرجّعها** — تشغيله ضد الإنتاج = تعطيل دفعات كامل.
- 🟠 `verify_jwt` للـkashier-webhook مش مثبّت في config.toml — دبلوي بدون `--no-verify-jwt` = كل الدفعات هتفشل بصمت.
- 🟠 الأدمن داشبورد بيسحب **كل** request_logs للمتصفح ويجمع في JS (مضاعف في Admin.tsx وuseModelUsage).
- متحقق جزئي: بوابة الـpending في الـgateway، بن مستخدم مش بيسحب مفاتيحه (مؤكدة في confirmed سياسة RLS فوق), هجمات `Origin` على merchantRedirect (مكرر، مؤكد أصلاً).

---

## 5) التحسينات (63 نتيجة — الأهم 15)

| # | التحسين | الموقع | الجهد |
|---|---------|--------|------|
| 1 | **Code splitting** — chunk واحد 1.39MB يشمل admin+recharts+framer للزائر المجهول | vite.config | S |
| 2 | **CI/CD** — مفيش GitHub Actions خالص؛ دبلوي يدوي wrangler | `.github/workflows` | M |
| 3 | **اختبارات آلية** — كل التحقق E2E يدوي وبيعدّل الإنتاج! | vitest/playwright | M |
| 4 | **KV/cache للمصادقة والكتالوج** — 4 رحلات DB لكل طلب شات | gateway-worker | M |
| 5 | **تنظيف daily_usage** — مش بيتنضف عمره | cron | S |
| 6 | **حذف ~1800 سطر ديزاين قديم يتيم** (Home/Models/Pricing/Docs, SiteHeader, PillNav, MoltenMetal) | web/src | S |
| 7 | حذف deps ميتة (zod, i18next-http-backend, gsap, ogl, 12 Radix wrapper) | package.json | S |
| 8 | **قبول ToS/Privacy عند التسجيل والدفع** — سياسة الاسترداد بتعتمد على موافقة مش بتتسجل أي حاجة | Signup + checkout | S |
| 9 | **بدون هوية قانونية/تواصل في Privacy** (مفيش كيان/إيميل تواصل) | Privacy.tsx | S |
| 10 | **بدون PITR/backup plan** للـPostgres | supabase | S |
| 11 | runbook حوادث (كل المفاتيح ماتت / المزود واقف) | docs | S |
| 12 | AnnouncementsLayer بيعمل refetch كل تغيير route + getUser() في 27 مسار | AnnouncementsLayer | S |
| 13 | Auth retry ممسك الطلب لـ45s قبل 503 | db.ts | S |
| 14 | عدم تسمية processors الحقيقيين (Kashier/Supabase/Cloudflare/GitHub) في الـPrivacy | Privacy.tsx | S |
| 15 | اثبت المستندات README/AGENTS.md على الواقع (Vite مش Next.js) | AGENTS.md | S |

---

## 6) خريطة المميزات المنطقية الناقصة (15 ميزة)

| الميزة | القيمة | أين تنزل | الجهد |
|--------|--------|----------|-------|
| **صفحة Terms of Service** (ناقصة خالص لمنتج مدفوع!) | قانوني حرج | `web/src/pages/marketing/` | S |
| **استرجاع كلمة السر** (منسي = حبس دائم) | حرج للـUX | Login.tsx + Supabase reset | S |
| **تنفيذ rate limiting فعلي** لكل مفتاح | أساسي للمنتج | gateway-worker | M |
| **إشعارات**: كوتا 80% / انتهاء اشتراك / إيصال دفع | عالي | new edge function + cron | M |
| **صفحة Logs حقيقية**: فلاتر + تفاصيل خطأ + تصدير + ترقيم | عالي | Logs.tsx | M |
| **Playground** لاختبار موديل من اللوحة | عالي | صفحة جديدة | M |
| **نموذج صحة الموديلات** (health badges) على صفحة الموديلات العامة | عالي | ModelsNew + probe cron | M |
| **إحصائيات زمنية للأدمن** (إيراد/MAU/أخطاء عبر الوقت) | متوسط | Admin.tsx + recharts | M |
| **توثيق API كامل**: جدول أكواد أخطاء + retry + SDK + /v1/models | متوسط | DocsNew.tsx | M |
| **عدّاد تنازلي للانتهاء + prompt تجديد داخل التطبيق** | متوسط | Dashboard.tsx | S |
| **تصدير CSV** للاستخدام | متوسط | Logs.tsx | S |
| **حذف حساب self-service** (موثوق في Privacy وغير موجود!) | قانوني | Settings.tsx + edge | M |
| **Outbound webhooks** لأحداث الكوتا/الدفع | متوسط | new edge fn | L |
| **فرق/مؤسسات** (team support) | كبير جداً | schema + UI | L |
| **سياسة حد أدنى للعمر** | قانوني | Signup + ToS | S |

**سريعات الفوز:** ToS · استرجاع باسورد · ظهور Purchases في السايدبار · حذف الحساب · تصدير CSV.

---

## 7) نتائج اترفضت (التحقق الخصومي قتلها) ✂️

1. ~~"kashier-webhook محتاج JWT بيمنع الكولباكات الحقيقية"~~ — الـdeploy الفعلي شغال بدون JWT والـsignature verification هي الحماية الحقيقية.
2. ~~"announcement cta_url بيقبل javascript:"~~ — الـURL بيتخزن وبيتعرض في `<a href>` بس، وReact/ReferrerPolicy بتحمي من السيناريو العملي (خطر منخفض لكن انتبه مستقبلاً).
3. ~~"CreateProviderModal بيلحق أول مفتاح بالمطابقة على display_name"~~ — دالـadmin-providers بترجّع الـid الفعلي؛ السيراريو غير قابل للحدوث.

## 8) ملحق — تغطية المدققين

| المدقق | الملفات | أبرز النتائج |
|--------|---------|---------------|
| rls | 16 migration + 45 سياسة + 20 جدول | CRITICAL: subscriptions anon INSERT (reproduced live) |
| gateway | 2190 LOC (index/failover/stream/quota/db) | 3× HIGH: body size / rate limit / settle loss |
| edgefn | 8 دوال (~1050 LOC) | coupon-per-user + merchantRedirect Origin |
| authn | 14 ملف مصادقة | github_created_at spoof + email confirmations off |
| payments | checkout + webhook + كاشير scripts | test-mode activation + EGP mismatch + TOCTOU |
| frontend-sec | 30+ ملف | XSS نظيف ✅ · CSP ناقصة · client-writable gate |
| frontend-quality | 60+ ملف + bundle 1390KB | error boundary صفر + i18n ×3 + dead code |
| ux | 28 ملف | password reset + notifications + logs فلاتر |
| ops | git history كاملة (68 commit) | .dev.vars + DEK rotation + CI صفر |
| quota-billing | 14 ملف (~2300 LOC) | sweeper + CAP_FRACTION + cross-midnight |
| performance | 2214 LOC + صفحات | 4 DB trips/طلب + aggregate double-parse |
| legal-privacy | 30 ملف (~4300 LOC) | ToS ناقص + حذف حساب موعود مش موجود |

---
*التحقق الخصومي: كل ثغرة/باج قابلت 2-3 مدققين مستقلين بعدسات مختلفة (exploitability / reachability / code-reality). الأرقام النهائية: 50 مؤكدة بالتحقق الخصومي + 6 اتأكدت يدوياً بعد توقف الورك فلو (منهم CRITICAL واحد اتأكد لايف) — إجمالي 56 نتيجة مؤكدة من 181 خام.*
