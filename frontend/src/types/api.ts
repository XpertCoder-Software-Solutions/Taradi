export type Role = "ADMIN" | "SUPERVISOR" | "EMPLOYEE";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageStatus = "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export type MessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VOICE"
  | "DOCUMENT"
  | "TEMPLATE"
  | "SYSTEM"
  | "VIDEO"
  | "STICKER"
  | "INTERACTIVE"
  | "UNKNOWN";
export type ConversationStatus = "OPEN" | "PENDING" | "CLOSED";
export type ConversationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type InvoiceStatus = "UNPAID" | "PAID" | "SCHEDULED" | "DISPUTED" | "CANCELLED";
export type CollectionStatus =
  | "ACTIVE_DEBT"
  | "PAID"
  | "PARTIALLY_PAID"
  | "PROMISED_TO_PAY"
  | "DISPUTED"
  | "DO_NOT_CONTACT";
export type EmployeeActivityType =
  | "LOGIN"
  | "SENT_MESSAGE"
  | "READ_CHAT"
  | "UPDATED_CUSTOMER"
  | "ASSIGNED_CUSTOMER"
  | "CHANGED_CONVERSATION_STATUS"
  | "NONE";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  message: string;
  errors: unknown[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface User {
  id: string;
  email: string | null;
  employeeCode?: string | null;
  name: string;
  fullName?: string;
  role: Role;
  supervisorId?: string | null;
  supervisor?: User | null;
  supervisorName?: string | null;
  isActive: boolean;
  permissions?: string[];
  assignedCustomersCount?: number;
  directReportsCount?: number;
  openConversationsCount?: number;
  unreadMessagesCount?: number;
  isOnline?: boolean;
  lastLoginAt?: string | null;
  lastActivityAt?: string | null;
  lastSeenAt?: string | null;
  lastActivityType?: EmployeeActivityType;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    assignedCustomers?: number;
    assignedConversations?: number;
    directReports?: number;
  };
}

export interface EmployeePresenceResponse {
  onlineUserIds: string[];
  lastSeen: Record<string, string | null>;
}

export interface Permission {
  id: string;
  key: string;
  nameAr: string;
  descriptionAr?: string | null;
  category: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PermissionCategory {
  key: string;
  nameAr: string;
  permissions: Permission[];
}

export interface PermissionMatrix {
  categories: PermissionCategory[];
  roles: Record<"SUPERVISOR" | "EMPLOYEE", Record<string, boolean>>;
}

export interface CustomerPhoneInfo {
  id: string;
  customerId: string;
  phoneNumber: string;
  isPrimary: boolean;
  position: number;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface Customer {
  id: string;
  fullName: string;
  name: string | null;
  phone: string;
  primaryPhone: string;
  phones?: CustomerPhoneInfo[];
  secondaryPhones?: string[];
  secondaryPhoneDetails?: CustomerPhoneInfo[];
  phoneNumbersCount?: number;
  nationalId?: string | null;
  accountNumber: string;
  projectName: string;
  debtAmount: string;
  serviceNumber: string;
  serviceActivationDate?: string | null;
  serviceTerminationDate?: string | null;
  invoiceStatus: InvoiceStatus;
  invoiceStatusLabel?: string;
  collectionStatus: CollectionStatus;
  collectionStatusLabel?: string;
  contactBlocked?: boolean;
  paidAt?: string | null;
  paidAmount?: string | null;
  paymentReference?: string | null;
  paymentNotes?: string | null;
  debtYear: number;
  notes: string | null;
  tags: string[];
  whatsappProfileName?: string | null;
  assignedToId: string | null;
  assignedTo?: User | null;
  assignedEmployeeId?: string | null;
  assignedEmployee?: User | null;
  collectorName?: string | null;
  supervisorName?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  customerId: string;
  conversationId?: string | null;
  direction: MessageDirection;
  type: MessageType;
  body?: string | null;
  content?: string | null;
  mediaUrl?: string | null;
  mediaId?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  caption?: string | null;
  duration?: number | null;
  templateName?: string | null;
  whatsappMessageId?: string | null;
  status: MessageStatus;
  statusUpdatedAt?: string | null;
  sentByUserId?: string | null;
  sentByUser?: User | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCustomerSummary {
  id: string;
  name: string | null;
  fullName?: string | null;
  phone: string;
  primaryPhone?: string;
  accountNumber?: string;
  projectName?: string;
  collectionStatus?: CollectionStatus;
  collectionStatusLabel?: string;
  contactBlocked?: boolean;
  whatsappProfileName?: string | null;
}

export interface Conversation {
  id: string;
  customerId: string;
  customer: ConversationCustomerSummary | null;
  assignedEmployeeId: string | null;
  assignedEmployee: User | null;
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  status: ConversationStatus;
  priority: ConversationPriority;
  tags: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessagesResponse {
  conversation: Conversation;
  items: Message[];
  meta: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface QueueJob {
  id: string | number;
  queue: string;
}

export interface CustomerImportError {
  row: number;
  reason: string;
}

export interface CustomerImportSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  assigned: number;
  errors: CustomerImportError[];
}
