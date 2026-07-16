# API Test Recipes

These examples assume:

- API is running at `http://localhost:4000`
- PostgreSQL is running through `docker compose up -d`
- The first admin has been seeded with `.env` values
- `jq` is installed for parsing JSON responses

Set shared variables:

```bash
export BASE_URL="http://localhost:4000"
export ADMIN_EMAIL="admin@taradiy.com"
export ADMIN_PASSWORD="123456789"
export RUN_ID="$(date +%s)"
export SUPERVISOR_CODE="SUP$RUN_ID"
export EMPLOYEE_CODE="EMP$RUN_ID"
export EMPLOYEE_NAME="Employee One"
export EMPLOYEE_PASSWORD="Employee123456!"
export CUSTOMER_PHONE="20100$(date +%s)"
```

## Admin Login

```bash
export ADMIN_TOKEN=$(
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | jq -r '.data.token'
)

echo "$ADMIN_TOKEN"
```

## Permissions Matrix

```bash
curl -s "$BASE_URL/api/settings/permissions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

Toggle only sent keys for a role:

```bash
curl -s -X PATCH "$BASE_URL/api/settings/permissions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role":"SUPERVISOR",
    "permissions":{
      "chats.send_message":true,
      "customers.create":false
    }
  }' \
| jq
```

## Create Supervisor

```bash
export SUPERVISOR_ID=$(
  curl -s -X POST "$BASE_URL/api/employees" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"employeeName\":\"Supervisor One\",
      \"employeeCode\":\"$SUPERVISOR_CODE\",
      \"role\":\"SUPERVISOR\",
      \"password\":\"$EMPLOYEE_PASSWORD\"
    }" \
  | jq -r '.data.employee.id'
)

echo "$SUPERVISOR_ID"
```

## Create Employee

```bash
export EMPLOYEE_ID=$(
  curl -s -X POST "$BASE_URL/api/employees" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"employeeName\":\"$EMPLOYEE_NAME\",
      \"employeeCode\":\"$EMPLOYEE_CODE\",
      \"role\":\"EMPLOYEE\",
      \"supervisorId\":\"$SUPERVISOR_ID\",
      \"password\":\"$EMPLOYEE_PASSWORD\"
    }" \
  | jq -r '.data.employee.id'
)

echo "$EMPLOYEE_ID"
```

## Create Customer

```bash
export CUSTOMER_ID=$(
  curl -s -X POST "$BASE_URL/api/customers" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "fullName":"Taradi Test Customer",
      "nationalId":"'"$(date +%s)"'",
      "accountNumber":"ACC-'"$(date +%s)"'",
      "projectName":"STC",
      "debtAmount":"2500.00",
      "serviceNumber":"SVC-'"$CUSTOMER_PHONE"'",
      "invoiceStatus":"UNPAID",
      "collectionStatus":"ACTIVE_DEBT",
      "debtYear":2026,
      "primaryPhone":"'"$CUSTOMER_PHONE"'",
      "notes":"Created from local API test",
      "tags":["test","local"],
      "assignedEmployeeId":"'"$EMPLOYEE_ID"'"
    }' \
  | jq -r '.data.customer.id'
)

echo "$CUSTOMER_ID"
```

## Import Customers From Excel Or CSV

Sample CSV content:

```csv
الجهة,اسم العميل,رقم الهوية,الرقم الرئيسي,رقم الحساب,مبلغ المديونية,المحصل,اسم المستخدم,المتابعة,رقم الخدمة,تأريخ تفعيل الخدمة,تاريخ إنتهاء الخدمة,حالة الفاتورة,تأريخ سنة المديونية
STC,Ahmed Ali,123456789,0501935233,ACC-1001,2500,EMPLOYEE NAME,portal-user-1,متابعة خلال أسبوع,SVC-1001,15/01/2021,20/03/2022,Closed - N,2021
```

Supported column aliases include:

- `مبلغ الميدونية` or `مبلغ المديونية`
- `رقم الخدمة` or `MSISDN`
- `تأريخ تفعيل الخدمة` or `CREATED_DATE`
- `تاريخ إنتهاء الخدمة` or `STATUS_DATE`
- `حالة الفاتورة` or `SERVICE_STATUS`
- `الرقم الرئيسي` is normalized from `0501935233` or `+966501935233` to `966501935233`
- `الجهة` is normalized: `موبايلي`/`mobily` -> `Mobily`, `اس تي سي`/`stc` -> `STC`, `زين`/`zain` -> `Zain`
- the original `الجهة` value is kept in `projectNameRaw` for auditing

Create a local sample and import it as admin:

```bash
printf '\357\273\277الجهة,اسم العميل,رقم الهوية,الرقم الرئيسي,رقم الحساب,مبلغ المديونية,المحصل,اسم المستخدم,المتابعة,رقم الخدمة,تأريخ تفعيل الخدمة,تاريخ إنتهاء الخدمة,حالة الفاتورة,تأريخ سنة المديونية\nSTC,Ahmed Ali,123456789,0501935233,ACC-1001,2500,%s,portal-user-1,متابعة خلال أسبوع,SVC-1001,15/01/2021,20/03/2022,Closed - N,2021\n' "$EMPLOYEE_NAME" > /tmp/taradi-customers.csv

curl -s -X POST "$BASE_URL/api/customers/import-excel" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@/tmp/taradi-customers.csv;type=text/csv" \
| jq
```

Expected response shape:

```json
{
  "success": true,
  "data": {
    "totalRows": 1,
    "created": 1,
    "updated": 0,
    "skipped": 0,
    "assigned": 1,
    "unassigned": 0,
    "warnings": [],
    "errors": []
  }
}
```

If the `المحصل` name is not found, the row is still imported as unassigned and the response includes a warning.

After the Employee Login section below, employees must not be able to import customer files:

```bash
curl -s -X POST "$BASE_URL/api/customers/import-excel" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -F "file=@/tmp/taradi-customers.csv;type=text/csv" \
| jq
```

## Assign Customer To Employee

```bash
curl -s -X PATCH "$BASE_URL/api/customers/$CUSTOMER_ID/assign" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"employeeId\":\"$EMPLOYEE_ID\"}" \
| jq
```

## Employee Login

```bash
export EMPLOYEE_TOKEN=$(
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"employeeCode\":\"$EMPLOYEE_CODE\",\"password\":\"$EMPLOYEE_PASSWORD\"}" \
  | jq -r '.data.token'
)

echo "$EMPLOYEE_TOKEN"
```

## Deactivate And Reactivate Employee Account

Deactivate the employee account as admin:

```bash
curl -s -X PATCH "$BASE_URL/api/employees/$EMPLOYEE_ID/deactivate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

Login should now fail:

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"employeeCode\":\"$EMPLOYEE_CODE\",\"password\":\"$EMPLOYEE_PASSWORD\"}" \
| jq
```

Old employee tokens should also be rejected:

```bash
curl -s "$BASE_URL/api/customers" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
| jq
```

Reactivate the employee account:

```bash
curl -s -X PATCH "$BASE_URL/api/employees/$EMPLOYEE_ID/activate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

Login should work again:

```bash
export EMPLOYEE_TOKEN=$(
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"employeeCode\":\"$EMPLOYEE_CODE\",\"password\":\"$EMPLOYEE_PASSWORD\"}" \
  | jq -r '.data.token'
)

echo "$EMPLOYEE_TOKEN"
```

## Employee List Assigned Customers

```bash
curl -s "$BASE_URL/api/customers" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
| jq
```

## Admin List All Chats

```bash
curl -s "$BASE_URL/api/chats" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

`/api/inbox` remains available as a legacy alias backed by the same Conversation Engine.

## Employee List Assigned Chats

```bash
curl -s "$BASE_URL/api/chats" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
| jq
```

## List Chat Messages

```bash
curl -s "$BASE_URL/api/chats/$CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

## Update Conversation Status And Priority

```bash
curl -s -X PATCH "$BASE_URL/api/chats/$CUSTOMER_ID/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"PENDING"}' \
| jq

curl -s -X PATCH "$BASE_URL/api/chats/$CUSTOMER_ID/priority" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"priority":"HIGH"}' \
| jq
```

## Mark Conversation Read

```bash
curl -s -X PATCH "$BASE_URL/api/chats/$CUSTOMER_ID/read" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

## WhatsApp Webhook GET Verification

```bash
curl -i -G "$BASE_URL/api/whatsapp/webhook" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=taradi-local-webhook-verify-token" \
  --data-urlencode "hub.challenge=taradi-local-challenge"
```

Expected response body:

```text
taradi-local-challenge
```

## WhatsApp Webhook POST Inbound Message Sample

```bash
export INBOUND_WEBHOOK_PHONE="201009998888"
export INBOUND_WEBHOOK_MESSAGE_ID="wamid.LOCAL.INBOUND.$(date +%s)"

curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "metadata": {
                "display_phone_number": "201000000000",
                "phone_number_id": "local-phone-number-id"
              },
              "contacts": [
                {
                  "profile": { "name": "Inbound Test Customer" },
                  "wa_id": "'"$INBOUND_WEBHOOK_PHONE"'"
                }
              ],
              "messages": [
                {
                  "from": "'"$INBOUND_WEBHOOK_PHONE"'",
                  "id": "'"$INBOUND_WEBHOOK_MESSAGE_ID"'",
                  "timestamp": "'"$(date +%s)"'",
                  "text": { "body": "Hello from a local webhook test" },
                  "type": "text"
                }
              ]
            }
          }
        ]
      }
    ]
  }' \
| jq
```

Expected webhook response:

- `.data.summary.status` is `PROCESSED`
- `.data.summary.processedCount` is `1`
- `.data.summary.inboundMessages[0].duplicate` is `false`
- Re-posting the same `$INBOUND_WEBHOOK_MESSAGE_ID` should not create another message or increment unread again; the webhook still returns success and the audit event can be `IGNORED` for the duplicate.

Expected database records:

- `WebhookEvent` has `eventType = messages` and `status = PROCESSED`
- `Customer.phone` is stored normalized, for example `201009998888`
- `Conversation` exists for that customer
- `Message` exists with:
  - `direction = INBOUND`
  - `type = TEXT`
  - `status = RECEIVED`
  - `customerId` set
  - `conversationId` set
  - `whatsappMessageId = $INBOUND_WEBHOOK_MESSAGE_ID`
  - `body = Hello from a local webhook test`
- `Conversation.lastMessageId` points at that message
- `Conversation.lastMessageAt` is set from the webhook timestamp
- `Conversation.unreadCount` increments by `1`
- `Conversation.status = OPEN`

Verify through the API:

```bash
curl -s "$BASE_URL/api/chats?search=$INBOUND_WEBHOOK_PHONE" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq '.data.items[0] | {
  customerId,
  conversationId: .id,
  unreadCount,
  status,
  lastMessage: {
    direction: .lastMessage.direction,
    type: .lastMessage.type,
    body: .lastMessage.body,
    whatsappMessageId: .lastMessage.whatsappMessageId
  }
}'
```

Capture the customer ID and verify the message list:

```bash
export INBOUND_CUSTOMER_ID=$(
  curl -s "$BASE_URL/api/chats?search=$INBOUND_WEBHOOK_PHONE" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -r '.data.items[0].customerId'
)

curl -s "$BASE_URL/api/chats/$INBOUND_CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq '.data.items[] | select(.whatsappMessageId == env.INBOUND_WEBHOOK_MESSAGE_ID) | {
  direction,
  type,
  status,
  body,
  customerId,
  conversationId,
  whatsappMessageId
}'
```

Expected realtime events for an authenticated Socket.IO client:

- `conversation:new_message`
- `conversation:updated`
- `notification:unread_count`

`conversation:new_message` and `conversation:updated` include:

- `conversationId`
- `customerId`
- `message`
- `conversation`
- `unreadCount`

Admins receive these events in the `admins` room. Assigned employees receive them in `user:{userId}`. Supervisors receive events for direct-report customers when the assigned user is included in the payload. Unassigned inbound conversations are visible to admins only until assignment.

## WhatsApp Webhook POST Inbound Media Sample

This sample uses a fake WhatsApp media id. The backend will store the media metadata and continue safely if the local test cannot download the file from Meta.

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "contacts": [
                {
                  "profile": { "name": "Inbound Media Customer" },
                  "wa_id": "201009997777"
                }
              ],
              "messages": [
                {
                  "from": "201009997777",
                  "id": "wamid.LOCAL.INBOUND.MEDIA.001",
                  "timestamp": "1720000002",
                  "type": "document",
                  "document": {
                    "id": "local-fake-media-id",
                    "mime_type": "application/pdf",
                    "filename": "sample.pdf",
                    "caption": "Document from local webhook test"
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  }' \
| jq
```

Then inspect the conversation:

```bash
curl -s "$BASE_URL/api/chats?search=201009997777" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

New inbound webhook customers are created as unassigned, so only admins can see them until assignment:

```bash
curl -s "$BASE_URL/api/chats?unassignedOnly=true" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq
```

Capture the inbound customer ID for follow-up tests:

```bash
export INBOUND_CUSTOMER_ID=$(
  curl -s "$BASE_URL/api/chats?unassignedOnly=true" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -r '.data.items[0].customerId'
)

echo "$INBOUND_CUSTOMER_ID"
```

Employee permission isolation: the employee should not be able to read the unassigned inbound conversation.

```bash
curl -i "$BASE_URL/api/chats/$INBOUND_CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN"
```

Expected status: `404`.

Assign it, then the employee can see it:

```bash
curl -s -X PATCH "$BASE_URL/api/customers/$INBOUND_CUSTOMER_ID/assign" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"employeeId\":\"$EMPLOYEE_ID\"}" \
| jq

curl -s "$BASE_URL/api/chats/$INBOUND_CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
| jq
```

## WhatsApp Webhook POST Message Status Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "statuses": [
                {
                  "id": "wamid.LOCAL.OUTBOUND.001",
                  "status": "delivered",
                  "timestamp": "1720000001",
                  "recipient_id": "201001234567"
                }
              ]
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Template Status Update Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "message_template_status_update",
            "value": {
              "message_template_name": "hello_world",
              "message_template_language": "en_US",
              "event": "APPROVED",
              "reason": "NONE"
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Template Quality Update Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "message_template_quality_update",
            "value": {
              "message_template_name": "hello_world",
              "message_template_language": "en_US",
              "quality_rating": "GREEN",
              "previous_quality_rating": "YELLOW",
              "reason": "QUALITY_IMPROVED"
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Template Components Update Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "message_template_components_update",
            "value": {
              "message_template_name": "hello_world",
              "message_template_language": "en_US",
              "components": [
                { "type": "BODY", "text": "Hello {{1}}" }
              ],
              "reason": "COMPONENTS_UPDATED"
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Phone Number Quality Update Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "phone_number_quality_update",
            "value": {
              "phone_number_id": "local-phone-number-id",
              "display_phone_number": "201000000000",
              "quality_rating": "GREEN",
              "previous_quality_rating": "YELLOW",
              "current_messaging_limit": "1K"
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Account Alert Sample

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "account_alerts",
            "value": {
              "alert_type": "POLICY_UPDATE",
              "severity": "INFO",
              "title": "Policy notice",
              "message": "Local account alert test",
              "details": { "source": "local-test" }
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## WhatsApp Webhook POST Calls Event Sample

Calls are currently ignored intentionally.

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "local-waba-id",
        "changes": [
          {
            "field": "calls",
            "value": {
              "call_id": "local-call-id",
              "from": "201009998888",
              "event": "connect"
            }
          }
        ]
      }
    ]
  }' \
| jq
```

## Send Manual Chat Message

This stores a `QUEUED` outbound message and creates a BullMQ job. Start `npm run worker:whatsapp` to send it through the real WhatsApp Cloud API.

```bash
curl -s -X POST "$BASE_URL/api/chats/$CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text":"Hello from Taradi CRM"
  }' \
| jq
```

## Quick WhatsApp Send

This sends a WhatsApp text by phone without manually creating a customer first. The API normalizes the phone, searches primary and secondary `CustomerPhone` records, reuses an existing customer/conversation when found, and creates a lightweight customer with `source=QUICK_SEND` only when no customer exists.

Permissions:
- Admin can quick send to any number and optionally pass `assignedToId`.
- Supervisor can assign to himself or employees under him.
- Employee is always assigned to himself and is blocked if the phone belongs to another employee.

Quick Send queues a normal WhatsApp `type=text` message immediately. It does not require or force a template. If Meta rejects the message because the customer did not start a conversation in the last 24 hours, the worker marks the message `FAILED` with:
`فشل الإرسال: لا يمكن إرسال رسالة نصية مباشرة لأن العميل لم يبدأ محادثة خلال آخر 24 ساعة.`

```bash
curl -s -X POST "$BASE_URL/api/chats/quick-send" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"201009999111",
    "message":"نص الرسالة"
  }' \
| jq
```

Optional assignment for Admin/Supervisor:

```bash
curl -s -X POST "$BASE_URL/api/chats/quick-send" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"phone\":\"201009999111\",
    \"message\":\"نص الرسالة\",
    \"assignedToId\":\"$EMPLOYEE_ID\"
  }" \
| jq
```

## Send Manual Media Chat Message

This stores a local file under `uploads/whatsapp`, creates a `QUEUED` outbound media message, and creates a BullMQ job. Start `npm run worker:whatsapp` with real WhatsApp credentials to upload/send it.

```bash
printf '%s\n' '%PDF-1.4' '1 0 obj <<>> endobj' 'trailer <<>>' '%%EOF' > /tmp/taradi-test.pdf

curl -s -X POST "$BASE_URL/api/chats/$CUSTOMER_ID/messages/media" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "type=document" \
  -F "caption=Document from Taradi CRM" \
  -F "file=@/tmp/taradi-test.pdf;type=application/pdf" \
| jq
```

Image example:

```bash
curl -s -X POST "$BASE_URL/api/chats/$CUSTOMER_ID/messages/media" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "type=image" \
  -F "caption=Image from Taradi CRM" \
  -F "file=@/path/to/image.jpg;type=image/jpeg" \
| jq
```

## Create Bulk Template Campaign

This endpoint queues a WhatsApp template message for each eligible selected customer. Customers with `collectionStatus=PAID` or `DO_NOT_CONTACT` are excluded automatically and returned under `excludedCustomers`. The worker requires a real approved template and valid WhatsApp Cloud API credentials to send successfully.

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/templates/bulk" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerIds\":[\"$CUSTOMER_ID\"],
    \"templateName\":\"hello_world\",
    \"languageCode\":\"en_US\",
    \"components\":[]
  }" \
| jq
```

## Mark Customer Paid And Validate Contact Blocking

```bash
curl -s -X PATCH "$BASE_URL/api/customers/$CUSTOMER_ID/collection-status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collectionStatus":"PAID",
    "paidAmount":"2500.00",
    "paymentReference":"BANK-123",
    "paymentNotes":"تم السداد عبر التحويل البنكي"
  }' \
| jq
```

Manual sends should now be blocked with Arabic message:

```bash
curl -i -X POST "$BASE_URL/api/chats/$CUSTOMER_ID/messages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "text":"This should be blocked" }'
```

Bulk campaigns including this customer should return it under `excludedCustomers` and not queue a message for it:

```bash
curl -s -X POST "$BASE_URL/api/whatsapp/templates/bulk" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerIds\":[\"$CUSTOMER_ID\"],
    \"templateName\":\"hello_world\",
    \"languageCode\":\"en_US\",
    \"components\":[]
  }" \
| jq
```
