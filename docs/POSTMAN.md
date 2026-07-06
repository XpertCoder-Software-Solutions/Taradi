# Postman Testing

Import these files into Postman:

- Collection: `docs/postman/Taradi WhatsApp CRM Backend.postman_collection.json`
- Environment: `docs/postman/Taradi Local.postman_environment.json`

Recommended order:

1. Run `Admin Login`
2. Run `Create Employee`
3. Run `Create Customer`
4. Run `Assign Customer To Employee`
5. Run `Employee Login`
6. Run the customer, inbox, webhook, and message requests

The collection stores these values automatically:

- `adminToken`
- `employeeToken`
- `employeeId`
- `customerId`

Manual replies and bulk templates call the real WhatsApp Cloud API. They need valid WhatsApp credentials in `.env`; placeholder credentials are expected to fail with a provider error.
