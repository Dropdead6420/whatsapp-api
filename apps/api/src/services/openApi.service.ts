interface BuildOpenApiSpecOptions {
  serverUrl: string;
}

function paginatedResponse(schemaRef: string) {
  return {
    type: "object",
    required: ["success", "data", "pagination"],
    properties: {
      success: { type: "boolean", example: true },
      data: {
        type: "array",
        items: { $ref: schemaRef },
      },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
  };
}

function successResponse(schemaRef: string) {
  return {
    type: "object",
    required: ["success", "data"],
    properties: {
      success: { type: "boolean", example: true },
      data: { $ref: schemaRef },
    },
  };
}

export function buildPublicOpenApiSpec(opts: BuildOpenApiSpecOptions) {
  return {
    openapi: "3.0.3",
    info: {
      title: "NexaFlow Public API",
      version: "1.0.0",
      description:
        "Tenant-scoped REST API for contacts, leads, conversations, and integration health checks.",
    },
    servers: [{ url: opts.serverUrl.replace(/\/$/, "") }],
    security: [{ bearerApiKey: [] }, { headerApiKey: [] }],
    tags: [
      { name: "Status", description: "API key and tenant health." },
      { name: "Contacts", description: "CRM contact management." },
      { name: "Leads", description: "Sales pipeline records." },
      { name: "Conversations", description: "WhatsApp conversation reads." },
    ],
    paths: {
      "/api/public/v1/status": {
        get: {
          tags: ["Status"],
          summary: "Validate API key",
          responses: {
            "200": {
              description: "API key is valid.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Status"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/contacts": {
        get: {
          tags: ["Contacts"],
          summary: "List contacts",
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 80 },
            },
            { name: "tag", in: "query", schema: { type: "string", maxLength: 40 } },
            { name: "optedOut", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": {
              description: "Paginated contacts.",
              content: {
                "application/json": {
                  schema: paginatedResponse("#/components/schemas/Contact"),
                },
              },
            },
          },
        },
        post: {
          tags: ["Contacts"],
          summary: "Create contact",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContactCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created contact.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Contact"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/contacts/{id}": {
        get: {
          tags: ["Contacts"],
          summary: "Get contact",
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Contact with recent leads and conversations.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Contact"),
                },
              },
            },
          },
        },
        patch: {
          tags: ["Contacts"],
          summary: "Update contact",
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContactUpdate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated contact.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Contact"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/leads": {
        get: {
          tags: ["Leads"],
          summary: "List leads",
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            {
              name: "status",
              in: "query",
              schema: { $ref: "#/components/schemas/LeadStatus" },
            },
            { name: "contactId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Paginated leads.",
              content: {
                "application/json": {
                  schema: paginatedResponse("#/components/schemas/Lead"),
                },
              },
            },
          },
        },
        post: {
          tags: ["Leads"],
          summary: "Create lead",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LeadCreate" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created lead.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Lead"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/leads/{id}": {
        get: {
          tags: ["Leads"],
          summary: "Get lead",
          parameters: [{ $ref: "#/components/parameters/Id" }],
          responses: {
            "200": {
              description: "Lead with contact details.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Lead"),
                },
              },
            },
          },
        },
        patch: {
          tags: ["Leads"],
          summary: "Update lead",
          parameters: [{ $ref: "#/components/parameters/Id" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LeadUpdate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated lead.",
              content: {
                "application/json": {
                  schema: successResponse("#/components/schemas/Lead"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/conversations": {
        get: {
          tags: ["Conversations"],
          summary: "List conversations",
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { name: "contactId", in: "query", schema: { type: "string" } },
            { name: "active", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": {
              description: "Paginated conversations.",
              content: {
                "application/json": {
                  schema: paginatedResponse("#/components/schemas/Conversation"),
                },
              },
            },
          },
        },
      },
      "/api/public/v1/conversations/{id}/messages": {
        get: {
          tags: ["Conversations"],
          summary: "List conversation messages",
          parameters: [
            { $ref: "#/components/parameters/Id" },
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
          ],
          responses: {
            "200": {
              description: "Paginated messages.",
              content: {
                "application/json": {
                  schema: paginatedResponse("#/components/schemas/Message"),
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerApiKey: {
          type: "http",
          scheme: "bearer",
          description: "Use the API key as a Bearer token.",
        },
        headerApiKey: {
          type: "apiKey",
          in: "header",
          name: "X-NexaFlow-API-Key",
        },
      },
      parameters: {
        Id: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        Page: {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        Limit: {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
      schemas: {
        Status: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            tenantId: { type: "string" },
            apiKeyId: { type: "string" },
            apiKeyName: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
            totalPages: { type: "integer" },
          },
        },
        LifecycleStage: {
          type: "string",
          enum: ["LEAD", "PROSPECT", "CUSTOMER", "REPEAT_CUSTOMER", "VIP", "CHURNED"],
        },
        LeadStatus: {
          type: "string",
          enum: [
            "NEW",
            "QUALIFIED",
            "NEGOTIATION",
            "PROPOSAL_SENT",
            "NEGOTIATION_FAILED",
            "CLOSED_WON",
            "CLOSED_LOST",
          ],
        },
        Contact: {
          type: "object",
          properties: {
            id: { type: "string" },
            phoneNumber: { type: "string", example: "+919876543210" },
            name: { type: "string" },
            email: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            customFields: { type: "string", nullable: true },
            optedOut: { type: "boolean" },
            lifecycleStage: { $ref: "#/components/schemas/LifecycleStage" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ContactCreate: {
          type: "object",
          required: ["phoneNumber", "name"],
          properties: {
            phoneNumber: { type: "string", example: "+919876543210" },
            name: { type: "string", maxLength: 120 },
            email: { type: "string", format: "email" },
            tags: { type: "array", items: { type: "string" }, maxItems: 20 },
            customFields: { type: "object", additionalProperties: true },
          },
        },
        ContactUpdate: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 120 },
            email: { type: "string", format: "email", nullable: true },
            tags: { type: "array", items: { type: "string" }, maxItems: 20 },
            customFields: { type: "object", additionalProperties: true, nullable: true },
            optedOut: { type: "boolean" },
            lifecycleStage: { $ref: "#/components/schemas/LifecycleStage" },
          },
        },
        Lead: {
          type: "object",
          properties: {
            id: { type: "string" },
            contactId: { type: "string" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: { $ref: "#/components/schemas/LeadStatus" },
            value: { type: "number", nullable: true },
            probability: { type: "number", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        LeadCreate: {
          type: "object",
          required: ["contactId", "title"],
          properties: {
            contactId: { type: "string" },
            title: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            value: { type: "number", minimum: 0 },
            probability: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        LeadUpdate: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000, nullable: true },
            status: { $ref: "#/components/schemas/LeadStatus" },
            value: { type: "number", minimum: 0, nullable: true },
            probability: { type: "number", minimum: 0, maximum: 1, nullable: true },
          },
        },
        Conversation: {
          type: "object",
          properties: {
            id: { type: "string" },
            contactId: { type: "string" },
            agentId: { type: "string", nullable: true },
            lastMessageAt: { type: "string", format: "date-time", nullable: true },
            isActive: { type: "boolean" },
            labels: { type: "array", items: { type: "string" } },
          },
        },
        Message: {
          type: "object",
          properties: {
            id: { type: "string" },
            conversationId: { type: "string" },
            direction: { type: "string", enum: ["INBOUND", "OUTBOUND"] },
            status: { type: "string", enum: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] },
            content: { type: "string" },
            mediaUrl: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  };
}
