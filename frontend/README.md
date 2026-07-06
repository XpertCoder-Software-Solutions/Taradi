# Taradi WhatsApp CRM Frontend

React dashboard for the Taradi WhatsApp CRM backend.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- React Router
- Axios
- Socket.IO client
- React Hook Form + Zod
- TanStack Query

## Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The frontend runs at:

```text
http://localhost:5173
```

The backend should be running at:

```text
http://localhost:4000
```

Swagger for backend route verification:

```text
http://localhost:4000/api/docs
```

## Environment

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
```

## Implemented MVP

- Login with JWT stored in localStorage for MVP
- Role-aware dashboard layout
- Admin pages:
  - Overview
  - Employees
  - Customers
  - Assignments
  - Inbox
  - Bulk Campaigns
  - Notifications
- Employee pages:
  - Overview
  - My Customers
  - My Inbox
  - Notifications
- WhatsApp inbox:
  - Conversation list
  - Unread counts
  - Message history
  - Text, image, audio/voice, and document rendering
  - Send text replies
  - Send media replies through multipart upload
  - Mark read on conversation selection
  - Update conversation status and priority
- Socket.IO notifications:
  - `message:received`
  - `message:sent`
  - `message:status`
  - `inbox:updated`

## Notes

- The frontend uses only the existing backend routes documented in Swagger and `docs/API_TESTS.md`.
- Admin-only navigation is hidden from employees and protected by route guards.
- The backend remains the source of truth for permissions; employees only receive assigned customers and conversations from the API.
