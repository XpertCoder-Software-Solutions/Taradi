const swaggerJSDoc = require("swagger-jsdoc");

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Taradi WhatsApp CRM Backend API",
      version: "0.1.0",
      description: [
        "Backend MVP for Taradi's WhatsApp CRM.",
        "Admins have unrestricted access.",
        "Supervisors can access assigned team data when enabled by dynamic permissions.",
        "Employees can only access customers and conversations assigned to them.",
        "Inbound WhatsApp customers are created unassigned and visible only to admins until assignment."
      ].join(" ")
    },
    servers: [],
    tags: [
      {
        name: "Health",
        description: "Service health checks."
      },
      {
        name: "Auth",
        description: "JWT authentication. Admins and supervisors login with email; employees login with employee code."
      },
      {
        name: "Employees",
        description: "Team account management for supervisors and employees."
      },
      {
        name: "Settings",
        description: "Admin-only settings and dynamic role permissions."
      },
      {
        name: "Customers",
        description: "Customer CRUD with role-based visibility."
      },
      {
        name: "Assignments",
        description: "Admin-only customer assignment workflows."
      },
      {
        name: "Chats",
        description: "Inbox, message history, manual replies, read state, and unread counts."
      },
      {
        name: "Notifications",
        description: "Unread counts are exposed through inbox/read-state endpoints; realtime events are delivered through Socket.IO."
      },
      {
        name: "WhatsApp",
        description: "WhatsApp Cloud API webhook verification, inbound messages, status updates, and template sends."
      },
      {
        name: "Campaigns",
        description: "Bulk WhatsApp template campaigns."
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste the JWT from /api/auth/login. Swagger sends it as Authorization: Bearer <token>."
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["success", "message", "errors"],
          properties: {
            success: {
              type: "boolean",
              example: false
            },
            message: {
              type: "string",
              example: "Validation failed"
            },
            errors: {
              type: "array",
              items: {
                type: "object"
              },
              example: []
            }
          }
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email", nullable: true },
            employeeCode: {
              type: "string",
              nullable: true,
              example: "EMP001",
              description: "Present for EMPLOYEE accounts only. Null for SUPERVISOR and ADMIN."
            },
            name: { type: "string" },
            fullName: { type: "string" },
            role: { type: "string", enum: ["ADMIN", "SUPERVISOR", "EMPLOYEE"] },
            supervisorId: { type: "string", format: "uuid", nullable: true },
            supervisorName: { type: "string", nullable: true, example: "أحمد المشرف" },
            isActive: { type: "boolean" },
            directReportsCount: { type: "integer", example: 4 },
            assignedCustomersCount: { type: "integer", example: 12 },
            openConversationsCount: { type: "integer", example: 3 },
            unreadMessagesCount: { type: "integer", example: 5 },
            isOnline: { type: "boolean", example: true },
            lastLoginAt: { type: "string", format: "date-time", nullable: true },
            lastActivityAt: { type: "string", format: "date-time", nullable: true },
            lastSeenAt: { type: "string", format: "date-time", nullable: true },
            lastActivityType: {
              type: "string",
              enum: [
                "LOGIN",
                "SENT_MESSAGE",
                "READ_CHAT",
                "UPDATED_CUSTOMER",
                "ASSIGNED_CUSTOMER",
                "CHANGED_CONVERSATION_STATUS",
                "NONE"
              ],
              example: "SENT_MESSAGE"
            },
            permissions: {
              type: "array",
              items: { type: "string" },
              example: ["chats.view_assigned", "chats.send_message"]
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        EmployeePresenceResponse: {
          type: "object",
          properties: {
            onlineUserIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
              example: ["0c5f77f3-f8b6-4db0-9641-9a4d8f968a7a"]
            },
            lastSeen: {
              type: "object",
              additionalProperties: {
                type: "string",
                format: "date-time",
                nullable: true
              },
              example: {
                "0c5f77f3-f8b6-4db0-9641-9a4d8f968a7a": "2026-07-06T12:45:00.000Z"
              }
            }
          }
        },
        LoginRequest: {
          type: "object",
          required: ["password"],
          properties: {
            email: {
              type: "string",
              format: "email",
              example: "supervisor@taradi.com",
              description: "Required for ADMIN and SUPERVISOR login."
            },
            employeeCode: {
              type: "string",
              example: "EMP001",
              description: "Required for EMPLOYEE login only."
            },
            password: { type: "string", example: "123456789" }
          },
          description: "Admins and supervisors login with email + password. Employees login with employeeCode + password."
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            },
            user: {
              $ref: "#/components/schemas/User"
            },
            role: { type: "string", enum: ["ADMIN", "SUPERVISOR", "EMPLOYEE"] },
            permissions: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        CreateEmployeeRequest: {
          type: "object",
          required: ["employeeName", "role", "password"],
          properties: {
            employeeName: { type: "string", example: "أحمد محمد" },
            employeeCode: {
              type: "string",
              nullable: true,
              example: "EMP001",
              description: "Required and unique for EMPLOYEE. Must be omitted/null for SUPERVISOR."
            },
            role: { type: "string", enum: ["SUPERVISOR", "EMPLOYEE"], example: "EMPLOYEE" },
            supervisorId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Required for EMPLOYEE. Must be null for SUPERVISOR."
            },
            email: {
              type: "string",
              format: "email",
              nullable: true,
              description: "Required and unique for SUPERVISOR. Not used for EMPLOYEE login."
            },
            password: { type: "string", minLength: 6, example: "123456" },
            isActive: { type: "boolean", default: true }
          },
          description: "Role is determined by the staff tab in the frontend. Supervisors have no employeeCode."
        },
        UpdateEmployeeRequest: {
          type: "object",
          properties: {
            employeeName: { type: "string", example: "أحمد محمد" },
            employeeCode: {
              type: "string",
              nullable: true,
              example: "EMP001",
              description: "Required and unique for EMPLOYEE. Must remain null for SUPERVISOR."
            },
            role: { type: "string", enum: ["SUPERVISOR", "EMPLOYEE"] },
            supervisorId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Required for EMPLOYEE and null for SUPERVISOR."
            },
            email: {
              type: "string",
              format: "email",
              nullable: true,
              description: "Required and unique for SUPERVISOR. Optional/null for EMPLOYEE."
            },
            password: { type: "string", minLength: 6, example: "123456" },
            isActive: { type: "boolean", example: true }
          },
          description: "Password is optional on update. Supervisors must not have employeeCode."
        },
        Permission: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            key: { type: "string", example: "chats.send_message" },
            nameAr: { type: "string", example: "إرسال رسالة نصية" },
            descriptionAr: { type: "string", nullable: true },
            category: { type: "string", example: "chats" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        PermissionMatrix: {
          type: "object",
          properties: {
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", example: "chats" },
                  nameAr: { type: "string", example: "المحادثات" },
                  permissions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Permission" }
                  }
                }
              }
            },
            roles: {
              type: "object",
              properties: {
                SUPERVISOR: {
                  type: "object",
                  additionalProperties: { type: "boolean" }
                },
                EMPLOYEE: {
                  type: "object",
                  additionalProperties: { type: "boolean" }
                }
              }
            }
          }
        },
        UpdatePermissionsRequest: {
          type: "object",
          required: ["role", "permissions"],
          properties: {
            role: { type: "string", enum: ["SUPERVISOR", "EMPLOYEE"], example: "SUPERVISOR" },
            permissions: {
              type: "object",
              additionalProperties: { type: "boolean" },
              example: {
                "chats.send_message": true,
                "customers.create": false
              }
            }
          }
        },
        Customer: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            fullName: { type: "string", example: "أحمد علي" },
            name: { type: "string", nullable: true, example: "أحمد علي" },
            phone: { type: "string", example: "966500000001", description: "Legacy alias for primaryPhone." },
            primaryPhone: { type: "string", example: "966500000001" },
            secondaryPhones: {
              type: "array",
              items: { type: "string" },
              example: ["966500000002", "966500000003"]
            },
            phones: {
              type: "array",
              items: { $ref: "#/components/schemas/CustomerPhone" }
            },
            secondaryPhoneDetails: {
              type: "array",
              items: { $ref: "#/components/schemas/CustomerPhone" }
            },
            phoneNumbersCount: { type: "integer", example: 3 },
            nationalId: { type: "string", nullable: true, example: "1234567890" },
            accountNumber: { type: "string", example: "ACC-1001" },
            projectName: { type: "string", example: "STC" },
            debtAmount: { type: "string", example: "2500.75" },
            serviceNumber: { type: "string", example: "SVC-9988" },
            serviceActivationDate: { type: "string", format: "date-time", nullable: true },
            serviceTerminationDate: { type: "string", format: "date-time", nullable: true },
            invoiceStatus: { type: "string", enum: ["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"], example: "UNPAID" },
            invoiceStatusLabel: { type: "string", example: "غير مدفوعة" },
            collectionStatus: {
              type: "string",
              enum: ["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"],
              example: "ACTIVE_DEBT"
            },
            collectionStatusLabel: { type: "string", example: "مديونية قائمة" },
            contactBlocked: {
              type: "boolean",
              example: false,
              description: "Computed true when collectionStatus is PAID or DO_NOT_CONTACT."
            },
            paidAt: { type: "string", format: "date-time", nullable: true },
            paidAmount: { type: "string", nullable: true, example: "1500.00" },
            paymentReference: { type: "string", nullable: true, example: "BANK-123" },
            paymentNotes: { type: "string", nullable: true, example: "تم السداد عبر التحويل البنكي" },
            debtYear: { type: "integer", example: 2021 },
            notes: { type: "string", nullable: true },
            tags: {
              type: "array",
              items: { type: "string" },
              example: ["vip", "lead"]
            },
            whatsappProfileName: { type: "string", nullable: true },
            assignedToId: { type: "string", format: "uuid", nullable: true },
            assignedEmployeeId: { type: "string", format: "uuid", nullable: true },
            collectorName: { type: "string", nullable: true, example: "محمد المحصل" },
            supervisorName: { type: "string", nullable: true, example: "أحمد المشرف" },
            createdById: { type: "string", format: "uuid", nullable: true },
            assignedTo: {
              allOf: [{ $ref: "#/components/schemas/User" }],
              nullable: true
            },
            assignedEmployee: {
              allOf: [{ $ref: "#/components/schemas/User" }],
              nullable: true
            },
            createdBy: {
              allOf: [{ $ref: "#/components/schemas/User" }],
              nullable: true
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        CustomerPhone: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            customerId: { type: "string", format: "uuid" },
            phoneNumber: { type: "string", example: "966500000001" },
            isPrimary: { type: "boolean", example: true },
            position: { type: "integer", example: 0 },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time", nullable: true }
          }
        },
        CreateCustomerRequest: {
          type: "object",
          required: [
            "fullName",
            "nationalId",
            "accountNumber",
            "projectName",
            "debtAmount",
            "serviceNumber",
            "invoiceStatus",
            "debtYear",
            "primaryPhone"
          ],
          properties: {
            fullName: { type: "string", example: "أحمد علي" },
            nationalId: { type: "string", example: "1234567890", description: "Required and unique." },
            accountNumber: { type: "string", example: "ACC-1001", description: "Required and unique." },
            projectName: { type: "string", example: "STC" },
            debtAmount: { type: "string", example: "2500.75" },
            serviceNumber: { type: "string", example: "SVC-9988" },
            serviceActivationDate: { type: "string", format: "date", nullable: true },
            serviceTerminationDate: { type: "string", format: "date", nullable: true },
            invoiceStatus: { type: "string", enum: ["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"], example: "UNPAID" },
            collectionStatus: {
              type: "string",
              enum: ["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"],
              example: "ACTIVE_DEBT"
            },
            paidAt: { type: "string", format: "date", nullable: true },
            paidAmount: { type: "string", nullable: true, example: "1500.00" },
            paymentReference: { type: "string", nullable: true, example: "BANK-123" },
            paymentNotes: { type: "string", nullable: true, example: "تم السداد عبر التحويل البنكي" },
            debtYear: { type: "integer", example: 2021 },
            primaryPhone: {
              type: "string",
              example: "966500000001"
            },
            secondaryPhones: {
              type: "array",
              items: { type: "string" },
              example: ["966500000002", "966500000003"]
            },
            notes: { type: "string", nullable: true, example: "Lead from WhatsApp" },
            assignedEmployeeId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Collector employee id. Employees automatically assign created customers to themselves when omitted."
            }
          }
        },
        UpdateCustomerRequest: {
          type: "object",
          properties: {
            fullName: { type: "string", example: "أحمد علي" },
            nationalId: { type: "string", example: "1234567890" },
            accountNumber: { type: "string", example: "ACC-1001" },
            projectName: { type: "string", example: "STC" },
            debtAmount: { type: "string", example: "2500.75" },
            serviceNumber: { type: "string", example: "SVC-9988" },
            serviceActivationDate: { type: "string", format: "date", nullable: true },
            serviceTerminationDate: { type: "string", format: "date", nullable: true },
            invoiceStatus: { type: "string", enum: ["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"] },
            collectionStatus: {
              type: "string",
              enum: ["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"]
            },
            paidAt: { type: "string", format: "date", nullable: true },
            paidAmount: { type: "string", nullable: true, example: "1500.00" },
            paymentReference: { type: "string", nullable: true, example: "BANK-123" },
            paymentNotes: { type: "string", nullable: true, example: "تم السداد عبر التحويل البنكي" },
            resetPayment: { type: "boolean", example: false },
            debtYear: { type: "integer", example: 2021 },
            primaryPhone: {
              type: "string",
              example: "966500000001"
            },
            secondaryPhones: {
              type: "array",
              items: { type: "string" },
              example: ["966500000002", "966500000003"]
            },
            notes: { type: "string", nullable: true, example: "Updated notes" },
            assignedEmployeeId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Collector employee id."
            }
          }
        },
        UpdateCustomerCollectionStatusRequest: {
          type: "object",
          required: ["collectionStatus"],
          properties: {
            collectionStatus: {
              type: "string",
              enum: ["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"],
              example: "PAID"
            },
            paidAt: { type: "string", format: "date", nullable: true },
            paidAmount: { type: "string", nullable: true, example: "1500" },
            paymentReference: { type: "string", nullable: true, example: "BANK-123" },
            paymentNotes: { type: "string", nullable: true, example: "تم السداد عبر التحويل البنكي" },
            resetPayment: {
              type: "boolean",
              example: false,
              description: "Admin-only explicit confirmation when changing PAID back to ACTIVE_DEBT and clearing paidAt."
            }
          }
        },
        AssignCustomerRequest: {
          type: "object",
          required: ["employeeId"],
          properties: {
            employeeId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Use null to unassign the customer."
            }
          }
        },
        Message: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            customerId: { type: "string", format: "uuid" },
            conversationId: { type: "string", format: "uuid", nullable: true },
            direction: { type: "string", enum: ["INBOUND", "OUTBOUND"] },
            type: {
              type: "string",
              enum: ["TEXT", "IMAGE", "AUDIO", "VOICE", "DOCUMENT", "TEMPLATE", "SYSTEM", "VIDEO", "STICKER", "INTERACTIVE", "UNKNOWN"]
            },
            body: { type: "string", nullable: true },
            content: { type: "string", nullable: true },
            mediaUrl: { type: "string", nullable: true, example: "/uploads/whatsapp/1720000000000-id.jpg" },
            mediaId: { type: "string", nullable: true, description: "WhatsApp Cloud API media id." },
            mimeType: { type: "string", nullable: true, example: "image/jpeg" },
            fileName: { type: "string", nullable: true, example: "invoice.pdf" },
            fileSize: { type: "integer", nullable: true, example: 240000 },
            caption: { type: "string", nullable: true, example: "Please review this file" },
            duration: { type: "integer", nullable: true, description: "Duration in seconds for voice/audio when available." },
            templateName: { type: "string", nullable: true },
            whatsappMessageId: { type: "string", nullable: true },
            status: { type: "string", enum: ["RECEIVED", "QUEUED", "SENT", "DELIVERED", "READ", "FAILED"] },
            statusUpdatedAt: { type: "string", format: "date-time", nullable: true },
            sentByUserId: { type: "string", format: "uuid", nullable: true },
            rawPayload: { type: "object", nullable: true },
            error: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        SendMessageRequest: {
          type: "object",
          required: ["text"],
          properties: {
            text: {
              type: "string",
              minLength: 1,
              maxLength: 4096,
              example: "Hello from Taradi CRM"
            }
          }
        },
        SendMediaMessageRequest: {
          type: "object",
          required: ["file", "type"],
          properties: {
            file: {
              type: "string",
              format: "binary"
            },
            type: {
              type: "string",
              enum: ["image", "audio", "voice", "document"],
              example: "image"
            },
            caption: {
              type: "string",
              nullable: true,
              maxLength: 1024,
              example: "Here is the requested document"
            }
          }
        },
        CreateCampaignRequest: {
          type: "object",
          required: ["customerIds", "templateName"],
          properties: {
            customerIds: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: { type: "string", format: "uuid" }
            },
            templateName: { type: "string", example: "hello_world" },
            languageCode: { type: "string", example: "en_US", default: "en_US" },
            components: {
              type: "array",
              items: { type: "object" },
              example: []
            }
          }
        },
        CampaignResponse: {
          type: "object",
          properties: {
            totalSelected: { type: "integer", example: 10 },
            eligibleRecipients: { type: "integer", example: 8 },
            excludedBlockedCustomers: { type: "integer", example: 2 },
            excludedCustomers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  customerId: { type: "string", format: "uuid" },
                  fullName: { type: "string", example: "أحمد علي" },
                  reason: { type: "string", example: "تم السداد" }
                }
              }
            },
            total: { type: "integer", example: 1 },
            queued: { type: "integer", example: 1 },
            failed: { type: "integer", example: 0 },
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  customerId: { type: "string", format: "uuid" },
                  messageId: { type: "string", format: "uuid" },
                  jobId: { type: "string" },
                  status: { type: "string", enum: ["QUEUED", "FAILED"] },
                  error: { type: "string" }
                }
              }
            }
          }
        },
        InboxItem: {
          allOf: [
            { $ref: "#/components/schemas/Customer" },
            {
              type: "object",
              properties: {
                lastMessage: {
                  allOf: [{ $ref: "#/components/schemas/Message" }],
                  nullable: true
                },
                unreadCount: { type: "integer", example: 2 }
              }
            }
          ]
        },
        Conversation: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            customerId: { type: "string", format: "uuid" },
            customer: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string", nullable: true },
                phone: { type: "string" },
                whatsappProfileName: { type: "string", nullable: true }
              }
            },
            assignedEmployeeId: { type: "string", format: "uuid", nullable: true },
            assignedEmployee: {
              allOf: [{ $ref: "#/components/schemas/User" }],
              nullable: true
            },
            lastMessage: {
              allOf: [{ $ref: "#/components/schemas/Message" }],
              nullable: true
            },
            lastMessageAt: { type: "string", format: "date-time", nullable: true },
            unreadCount: { type: "integer", example: 2 },
            status: { type: "string", enum: ["OPEN", "PENDING", "CLOSED"] },
            priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
            tags: {
              type: "array",
              items: { type: "string" },
              example: ["vip"]
            },
            archivedAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        UpdateConversationStatusRequest: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["OPEN", "PENDING", "CLOSED"], example: "PENDING" }
          }
        },
        UpdateConversationPriorityRequest: {
          type: "object",
          required: ["priority"],
          properties: {
            priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"], example: "HIGH" }
          }
        },
        CustomerReadState: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            customerId: { type: "string", format: "uuid" },
            userId: { type: "string", format: "uuid" },
            lastReadAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        PaginationMeta: {
          type: "object",
          properties: {
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 50 },
            total: { type: "integer", example: 12 }
          }
        },
        WhatsAppWebhookPayload: {
          type: "object",
          description: "Meta WhatsApp Cloud API webhook payload. Supported fields include messages, message_template_status_update, message_template_quality_update, message_template_components_update, phone_number_quality_update, account_alerts, and calls.",
          example: {
            object: "whatsapp_business_account",
            entry: [
              {
                id: "local-waba-id",
                changes: [
                  {
                    field: "messages",
                    value: {
                      messaging_product: "whatsapp",
                      contacts: [
                        {
                          profile: { name: "Inbound Test Customer" },
                          wa_id: "201009998888"
                        }
                      ],
                      messages: [
                        {
                          from: "201009998888",
                          id: "wamid.LOCAL.INBOUND.001",
                          timestamp: "1720000000",
                          text: { body: "Hello from a local webhook test" },
                          type: "text"
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        },
        WebhookSummaryResponse: {
          type: "object",
          properties: {
            auditEventId: { type: "string", format: "uuid" },
            eventType: {
              type: "string",
              example: "messages"
            },
            summary: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["PROCESSED", "FAILED", "IGNORED"]
                },
                eventTypes: {
                  type: "array",
                  items: { type: "string" },
                  example: ["messages"]
                },
                processedCount: { type: "integer", example: 1 },
                ignoredCount: { type: "integer", example: 0 },
                inboundMessages: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      customerId: { type: "string", format: "uuid" },
                      duplicate: { type: "boolean" }
                    }
                  }
                },
                statuses: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      whatsappMessageId: { type: "string" },
                      messageId: { type: "string", format: "uuid" },
                      updated: { type: "boolean" },
                      status: { type: "string" }
                    }
                  }
                },
                ignored: {
                  type: "array",
                  items: {
                    type: "object"
                  }
                },
                templateStatus: {
                  type: "array",
                  items: { type: "object" }
                },
                templateQuality: {
                  type: "array",
                  items: { type: "object" }
                },
                templateComponents: {
                  type: "array",
                  items: { type: "object" }
                },
                phoneNumberQuality: {
                  type: "array",
                  items: { type: "object" }
                },
                accountAlerts: {
                  type: "array",
                  items: { type: "object" }
                },
                calls: {
                  type: "array",
                  items: { type: "object" }
                }
              }
            }
          }
        }
      },
      responses: {
        Unauthorized: {
          description: "Authentication token is missing, invalid, or expired.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" }
            }
          }
        },
        Forbidden: {
          description: "The authenticated user does not have permission.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" }
            }
          }
        },
        NotFound: {
          description: "The requested resource was not found or is not accessible.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" }
            }
          }
        },
        ValidationError: {
          description: "Request validation failed.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" }
            }
          }
        }
      },
      parameters: {
        CustomerId: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
          description: "Customer ID."
        },
        ChatCustomerId: {
          name: "customerId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
          description: "Customer ID for the conversation."
        },
        EmployeeId: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
          description: "Employee ID."
        },
        Page: {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, default: 1 }
        },
        Limit: {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
        },
        Search: {
          name: "search",
          in: "query",
          schema: { type: "string" }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Check service health",
          responses: {
            200: {
              description: "Service is healthy.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      service: { type: "string", example: "taradi-whatsapp-crm-backend" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login as admin, supervisor, or employee",
          description: "Admins and supervisors login with email and password. Employees login with employeeCode and password.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "JWT and authenticated user.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LoginResponse" }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Get current authenticated user",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Current user.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/User" },
                      role: { type: "string", enum: ["ADMIN", "SUPERVISOR", "EMPLOYEE"] },
                      permissions: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/employees": {
        get: {
          tags: ["Employees"],
          summary: "List staff accounts",
          description: "Admins see supervisors and employees. Supervisors see employees assigned to them. employeeCode is returned only for employees.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Search" },
            {
              name: "role",
              in: "query",
              schema: { type: "string", enum: ["SUPERVISOR", "EMPLOYEE"] }
            },
            {
              name: "isActive",
              in: "query",
              schema: { type: "boolean" }
            },
            {
              name: "supervisorId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Admin only. Filter employees under a specific supervisor."
            },
            {
              name: "sortBy",
              in: "query",
              schema: { type: "string", enum: ["name", "employeeCode", "createdAt", "assignedCustomersCount"] }
            },
            {
              name: "sortOrder",
              in: "query",
              schema: { type: "string", enum: ["asc", "desc"] }
            }
          ],
          responses: {
            200: {
              description: "Paginated staff accounts.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/User" }
                      },
                      meta: { $ref: "#/components/schemas/PaginationMeta" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        },
        post: {
          tags: ["Employees"],
          summary: "Create supervisor or employee",
          description: "Admin only. SUPERVISOR accounts require email and no employeeCode. EMPLOYEE accounts require employeeCode and supervisorId.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateEmployeeRequest" }
              }
            }
          },
          responses: {
            201: {
              description: "Staff account created.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      employee: { $ref: "#/components/schemas/User" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        }
      },
      "/api/employees/presence": {
        get: {
          tags: ["Employees"],
          summary: "Employee realtime presence",
          description: "Returns Socket.IO-based online users and last seen timestamps. Admins see all staff, supervisors see their team, and employees see themselves.",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Scoped employee presence snapshot.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EmployeePresenceResponse" }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/employees/{id}": {
        patch: {
          tags: ["Employees"],
          summary: "Update supervisor or employee",
          description: "Admin only. SUPERVISOR accounts keep employeeCode null and supervisorId null.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/EmployeeId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateEmployeeRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Staff account updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      employee: { $ref: "#/components/schemas/User" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        },
        delete: {
          tags: ["Employees"],
          summary: "Deactivate employee",
          description: "Admin only. This marks the employee inactive instead of deleting the record.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/EmployeeId" }],
          responses: {
            200: {
              description: "Employee deactivated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      employee: { $ref: "#/components/schemas/User" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/employees/{id}/deactivate": {
        patch: {
          tags: ["Employees"],
          summary: "Deactivate employee account",
          description: "Admin only. Marks an employee inactive. Existing assignments remain unchanged. Inactive employees cannot login or use old API tokens.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/EmployeeId" }],
          responses: {
            200: {
              description: "Employee account deactivated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      employee: { $ref: "#/components/schemas/User" },
                      message: { type: "string", example: "تم تعطيل حساب الموظف" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/employees/{id}/activate": {
        patch: {
          tags: ["Employees"],
          summary: "Activate employee account",
          description: "Admin only. Reactivates an employee so they can login and access assigned resources again.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/EmployeeId" }],
          responses: {
            200: {
              description: "Employee account activated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      employee: { $ref: "#/components/schemas/User" },
                      message: { type: "string", example: "تم تفعيل حساب الموظف" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/settings/permissions": {
        get: {
          tags: ["Settings"],
          summary: "Get role permission matrix",
          description: "Admin only. Returns all permission definitions grouped by category and the current enabled matrix for SUPERVISOR and EMPLOYEE.",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Permission matrix.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PermissionMatrix" }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        },
        patch: {
          tags: ["Settings"],
          summary: "Update role permissions",
          description: "Admin only. Updates only the sent permission keys for SUPERVISOR or EMPLOYEE. ADMIN permissions cannot be restricted.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdatePermissionsRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Updated permission matrix.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PermissionMatrix" }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        }
      },
      "/api/customers": {
        get: {
          tags: ["Customers"],
          summary: "List visible customers",
          description: "Admins see all customers. Supervisors see customers assigned to themselves or direct reports when team view is enabled. Employees see assigned customers only.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Search" },
            {
              name: "assignment",
              in: "query",
              schema: { type: "string", enum: ["unassigned"] },
              description: "Admin only. Filters to unassigned customers."
            },
            {
              name: "assignedToId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Legacy alias. Filters customers assigned to a specific collector."
            },
            {
              name: "assignedEmployeeId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Filters customers assigned to a specific collector."
            },
            {
              name: "supervisorId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Filters by the assigned collector's supervisor. If assigned directly to a supervisor, the supervisor id also matches."
            },
            {
              name: "projectName",
              in: "query",
              schema: { type: "string", enum: ["STC", "Mobily"] },
              description: "Filters by project/operator."
            },
            {
              name: "invoiceStatus",
              in: "query",
              schema: { type: "string", enum: ["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"] },
              description: "Filters by invoice status."
            },
            {
              name: "collectionStatus",
              in: "query",
              schema: {
                type: "string",
                enum: ["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"]
              },
              description: "Filters by debt collection status."
            },
            {
              name: "debtYear",
              in: "query",
              schema: { type: "integer", example: 2026 },
              description: "Filters by debt year."
            },
            {
              name: "sortBy",
              in: "query",
              schema: { type: "string", enum: ["fullName", "debtAmount", "createdAt"] },
              description: "Sort field."
            },
            {
              name: "sortOrder",
              in: "query",
              schema: { type: "string", enum: ["asc", "desc"] },
              description: "Sort direction."
            },
            {
              name: "contactBlocked",
              in: "query",
              schema: { type: "boolean" },
              description: "Filters customers where contact is blocked or allowed."
            },
            {
              name: "paidOnly",
              in: "query",
              schema: { type: "boolean" },
              description: "Shortcut for collectionStatus=PAID."
            }
          ],
          responses: {
            200: {
              description: "Paginated customers.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Customer" }
                      },
                      meta: { $ref: "#/components/schemas/PaginationMeta" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        },
        post: {
          tags: ["Customers"],
          summary: "Create customer",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateCustomerRequest" }
              }
            }
          },
          responses: {
            201: {
              description: "Customer created.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      customer: { $ref: "#/components/schemas/Customer" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/customers/import-csv": {
        post: {
          tags: ["Customers"],
          summary: "Import customers from CSV",
          description: "Permission controlled. Supports Taradi debt collection columns: اسم العميل، رقم الهوية، رقم الحساب، الجهة، مبلغ المديونية، رقم الخدمة، تواريخ الخدمة، حالة الفاتورة، حالة التحصيل، تاريخ السداد، المبلغ المسدد، رقم مرجع السداد، ملاحظات السداد، سنة المديونية، رقم الهاتف الرئيسي، unlimited رقم الهاتف الفرعيN columns، واسم المحصل.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "CSV file up to 5MB. Field name must be file."
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "CSV import summary.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      totalRows: { type: "integer", example: 100 },
                      created: { type: "integer", example: 80 },
                      updated: { type: "integer", example: 15 },
                      skipped: { type: "integer", example: 5 },
                      assigned: { type: "integer", example: 70 },
                      errors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            row: { type: "integer", example: 7 },
                            reason: { type: "string", example: "رقم الهاتف مطلوب" }
                          }
                        }
                      }
                    }
                  },
                  example: {
                    success: true,
                    data: {
                      totalRows: 100,
                      created: 80,
                      updated: 15,
                      skipped: 5,
                      assigned: 70,
                      errors: [
                        { row: 7, reason: "رقم الهاتف مطلوب" }
                      ]
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        }
      },
      "/api/customers/{id}": {
        get: {
          tags: ["Customers"],
          summary: "Get customer",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          responses: {
            200: {
              description: "Customer details.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      customer: { $ref: "#/components/schemas/Customer" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        },
        patch: {
          tags: ["Customers"],
          summary: "Update customer",
          description: "Employees can only update assigned customers. Admins can update any customer.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateCustomerRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Customer updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      customer: { $ref: "#/components/schemas/Customer" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        },
        delete: {
          tags: ["Customers"],
          summary: "Delete customer",
          description: "Admin only.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          responses: {
            200: {
              description: "Customer deleted.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      deleted: { type: "boolean", example: true }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/customers/{id}/collection-status": {
        patch: {
          tags: ["Customers"],
          summary: "Update customer collection status",
          description: "Updates collectionStatus and payment fields. PAID and DO_NOT_CONTACT automatically block contact; PAID customers are excluded from campaigns and their conversation is closed.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateCustomerCollectionStatusRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Collection status updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      customer: { $ref: "#/components/schemas/Customer" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/customers/{id}/assign": {
        patch: {
          tags: ["Assignments"],
          summary: "Assign or unassign customer",
          description: "Admins can assign to supervisors or employees and can unassign with null. Supervisors with customers.assign can assign within their team.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AssignCustomerRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Customer assignment updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      customer: { $ref: "#/components/schemas/Customer" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/chats": {
        get: {
          tags: ["Chats", "Notifications"],
          summary: "List conversation inbox",
          description: "Conversation Engine inbox. Admins see all conversations, including unassigned conversations. Supervisors see their team scope when chats.view_team is enabled. Employees see assigned conversations only.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Search" },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["OPEN", "PENDING", "CLOSED"] }
            },
            {
              name: "assignedEmployeeId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Admin only. Filters conversations assigned to a specific employee."
            },
            {
              name: "unreadOnly",
              in: "query",
              schema: { type: "boolean" },
              description: "When true, returns conversations with unreadCount greater than 0."
            },
            {
              name: "unassignedOnly",
              in: "query",
              schema: { type: "boolean" },
              description: "Admin only. Returns unassigned conversations."
            }
          ],
          responses: {
            200: {
              description: "Paginated conversation inbox.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Conversation" }
                      },
                      meta: { $ref: "#/components/schemas/PaginationMeta" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/chats/{customerId}/messages": {
        get: {
          tags: ["Chats"],
          summary: "List conversation messages",
          description: "Messages are returned oldest to newest. Admins can read any conversation. Supervisors and employees are limited by their data scope and view permission.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/ChatCustomerId" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 100 }
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Message ID cursor."
            }
          ],
          responses: {
            200: {
              description: "Conversation and ordered message history.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      conversation: { $ref: "#/components/schemas/Conversation" },
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Message" }
                      },
                      meta: {
                        type: "object",
                        properties: {
                          limit: { type: "integer" },
                          nextCursor: { type: "string", format: "uuid", nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        },
        post: {
          tags: ["Chats", "WhatsApp"],
          summary: "Queue manual reply for a conversation",
          description: "Requires chats.send_message. Stores an outbound message linked to the conversation and queues it for the WhatsApp worker. Blocks sending only when customer.contactBlocked is true.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/ChatCustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageRequest" }
              }
            }
          },
          responses: {
            201: {
              description: "Outbound message stored and queued.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { $ref: "#/components/schemas/Message" },
                      job: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          queue: { type: "string", example: "whatsapp-outbound" }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/chats/{customerId}/messages/media": {
        post: {
          tags: ["Chats", "WhatsApp"],
          summary: "Queue media reply for a conversation",
          description: "Requires chats.send_media. Uploads a local file to Taradi storage, stores a queued outbound media message, and lets the WhatsApp worker upload/send it through WhatsApp Cloud API.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/ChatCustomerId" }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: { $ref: "#/components/schemas/SendMediaMessageRequest" },
                encoding: {
                  file: {
                    contentType: [
                      "image/jpeg",
                      "image/png",
                      "image/webp",
                      "audio/ogg",
                      "audio/mpeg",
                      "audio/mp4",
                      "application/pdf",
                      "application/msword",
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ].join(", ")
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Outbound media message stored and queued.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { $ref: "#/components/schemas/Message" },
                      job: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          queue: { type: "string", example: "whatsapp-outbound" }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/chats/{customerId}/read": {
        patch: {
          tags: ["Chats", "Notifications"],
          summary: "Mark conversation as read",
          description: "Requires chats.mark_read. Sets Conversation.unreadCount to 0 within the user's data scope.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/ChatCustomerId" }],
          responses: {
            200: {
              description: "Conversation unread count cleared and read state updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      conversation: { $ref: "#/components/schemas/Conversation" },
                      readState: { $ref: "#/components/schemas/CustomerReadState" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/chats/{customerId}/status": {
        patch: {
          tags: ["Chats"],
          summary: "Update conversation status",
          description: "Requires chats.change_status. Setting CLOSED also requires chats.close_conversation.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/ChatCustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateConversationStatusRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Conversation status updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      conversation: { $ref: "#/components/schemas/Conversation" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/chats/{customerId}/priority": {
        patch: {
          tags: ["Chats"],
          summary: "Update conversation priority",
          description: "Requires chats.change_priority and is still limited by data scope.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/ChatCustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateConversationPriorityRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Conversation priority updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      conversation: { $ref: "#/components/schemas/Conversation" }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/inbox": {
        get: {
          tags: ["Chats", "Notifications"],
          summary: "List chat inbox with unread counts",
          description: "Legacy inbox route backed by the Conversation Engine. Prefer /api/chats for new clients. Visibility follows the same role and permission scope.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Search" },
            {
              name: "assignment",
              in: "query",
              schema: { type: "string", enum: ["unassigned"] },
              description: "Admin only. Filters to unassigned inbound chats."
            }
          ],
          responses: {
            200: {
              description: "Paginated conversation inbox with last message and unread counts.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Conversation" }
                      },
                      meta: { $ref: "#/components/schemas/PaginationMeta" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/customers/{id}/messages": {
        get: {
          tags: ["Chats"],
          summary: "List customer messages",
          description: "Employees can only list messages for assigned customers.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/CustomerId" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Message ID cursor for older messages."
            }
          ],
          responses: {
            200: {
              description: "Message list.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Message" }
                      },
                      meta: {
                        type: "object",
                        properties: {
                          limit: { type: "integer" },
                          nextCursor: { type: "string", format: "uuid", nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        },
        post: {
          tags: ["Chats", "WhatsApp"],
          summary: "Queue manual WhatsApp reply",
          description: "Requires chats.send_message. The API stores a QUEUED outbound message and the worker sends it through WhatsApp Cloud API. Blocks sending only when customer.contactBlocked is true.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageRequest" }
              }
            }
          },
          responses: {
            201: {
              description: "Outbound message stored and queued for the WhatsApp worker.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { $ref: "#/components/schemas/Message" },
                      job: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          queue: { type: "string", example: "whatsapp-outbound" }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/customers/{id}/messages/read": {
        post: {
          tags: ["Chats", "Notifications"],
          summary: "Mark customer conversation as read",
          description: "Updates the current user's read state and resets unread count for this conversation.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/CustomerId" }],
          responses: {
            200: {
              description: "Read state updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      readState: { $ref: "#/components/schemas/CustomerReadState" }
                    }
                  }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      },
      "/api/whatsapp/webhook": {
        get: {
          tags: ["WhatsApp"],
          summary: "Verify WhatsApp webhook",
          description: "Meta calls this endpoint with hub.mode, hub.verify_token, and hub.challenge.",
          parameters: [
            {
              name: "hub.mode",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["subscribe"] }
            },
            {
              name: "hub.verify_token",
              in: "query",
              required: true,
              schema: { type: "string", example: "taradi-local-webhook-verify-token" }
            },
            {
              name: "hub.challenge",
              in: "query",
              required: true,
              schema: { type: "string", example: "taradi-local-challenge" }
            }
          ],
          responses: {
            200: {
              description: "Webhook challenge echoed as plain text.",
              content: {
                "text/plain": {
                  schema: { type: "string", example: "taradi-local-challenge" }
                }
              }
            },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        },
        post: {
          tags: ["WhatsApp"],
          summary: "Receive WhatsApp webhook events",
          description: "Accepts WhatsApp webhook events, creates a WebhookEvent audit record, dispatches to the matching handler, and returns 200 for accepted events. Unknown events and calls are safely marked ignored. If VERIFY_META_SIGNATURE=true, X-Hub-Signature-256 must be valid.",
          parameters: [
            {
              name: "X-Hub-Signature-256",
              in: "header",
              required: false,
              schema: { type: "string", example: "sha256=..." },
              description: "Required only when VERIFY_META_SIGNATURE=true."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WhatsAppWebhookPayload" }
              }
            }
          },
          responses: {
            200: {
              description: "Webhook accepted and dispatched. The response includes audit event id and processing summary.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WebhookSummaryResponse" }
                }
              }
            },
            401: { $ref: "#/components/responses/Unauthorized" }
          }
        }
      },
      "/api/whatsapp/templates/bulk": {
        post: {
          tags: ["Campaigns", "WhatsApp"],
          summary: "Create bulk WhatsApp template campaign",
          description: "Requires campaigns.send. Queues an approved WhatsApp template for selected customers within the user's data scope. Customers with PAID or DO_NOT_CONTACT collection status are excluded. Campaigns use each customer's primary phone.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateCampaignRequest" }
              }
            }
          },
          responses: {
            201: {
              description: "Campaign send results.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CampaignResponse" }
                }
              }
            },
            400: { $ref: "#/components/responses/ValidationError" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" }
          }
        }
      }
    }
  },
  apis: []
});

function isJsonSuccessResponse(statusCode, response) {
  return (
    String(statusCode).startsWith("2") &&
    response &&
    response.content &&
    response.content["application/json"] &&
    response.content["application/json"].schema
  );
}

function wrapSuccessfulJsonResponses(spec) {
  for (const pathItem of Object.values(spec.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation || !operation.responses) {
        continue;
      }

      for (const [statusCode, response] of Object.entries(operation.responses)) {
        if (!isJsonSuccessResponse(statusCode, response)) {
          continue;
        }

        const mediaType = response.content["application/json"];
        const schema = mediaType.schema;

        if (schema.properties && schema.properties.success && schema.properties.data) {
          continue;
        }

        mediaType.schema = {
          type: "object",
          required: ["success", "data"],
          properties: {
            success: {
              type: "boolean",
              example: true
            },
            data: schema
          }
        };
      }
    }
  }

  return spec;
}

const baseSwaggerSpec = wrapSuccessfulJsonResponses(swaggerSpec);

function firstForwardedValue(value) {
  if (!value) {
    return null;
  }

  const rawValue = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue !== "string") {
    return null;
  }

  return rawValue.split(",")[0].trim() || null;
}

function getRequestBaseUrl(req) {
  const forwardedProto = firstForwardedValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstForwardedValue(req.headers["x-forwarded-host"]);
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host");

  return `${protocol}://${host}`;
}

function getSwaggerSpecForRequest(req) {
  const spec = JSON.parse(JSON.stringify(baseSwaggerSpec));

  spec.servers = [
    {
      url: getRequestBaseUrl(req),
      description: "Current request origin"
    }
  ];

  return spec;
}

module.exports = {
  swaggerSpec: baseSwaggerSpec,
  getRequestBaseUrl,
  getSwaggerSpecForRequest
};
