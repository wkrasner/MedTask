// ─── Shared types ────────────────────────────────────────────────────────────
// Single-table DynamoDB design:
//   PK: TASK#<taskId>    SK: TYPE#<taskType>
//   GSI1PK: STATUS#<status>   GSI1SK: UPDATED#<isoDate>
//   GSI2PK: STAFF#<userId>    GSI2SK: UPDATED#<isoDate>

export type TaskType = "prior-auth" | "prescription" | "return-call" | "scheduling" | "records-request" | "referral";
export type TaskStatus = "open" | "in-progress" | "pending" | "completed" | "cancelled" | "denied";
export type Priority = "low" | "normal" | "high" | "urgent";

export interface BaseTask {
  taskId: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: Priority;
  patientId: string;
  patientName: string;
  patientDob: string;          // YYYY-MM-DD
  assignedTo?: string;         // Cognito userId
  assignedName?: string;
  notes: string;
  createdBy: string;
  createdAt: string;           // ISO 8601
  updatedAt: string;
  dueDate?: string;
  completedAt?: string;
}

export interface PriorAuth extends BaseTask {
  taskType: "prior-auth";
  insuranceName: string;
  insuranceMemberId: string;
  medicationOrProcedure: string;
  authNumber?: string;
  authExpiresDate?: string;
  denialReason?: string;
  appealDeadline?: string;
}

export interface Prescription extends BaseTask {
  taskType: "prescription";
  medicationName: string;
  dosage: string;
  quantity: number;
  refillsRemaining: number;
  pharmacy: string;
  prescribingProvider: string;
  sentToPharmacy?: boolean;
  sentAt?: string;
}

export interface ReturnCall extends BaseTask {
  taskType: "return-call";
  callbackNumber: string;
  reasonForCall: string;
  callerName: string;
  calledBack?: boolean;
  callbackAttempts: number;
  lastAttemptAt?: string;
}

export interface Scheduling extends BaseTask {
  taskType: "scheduling";
  appointmentType: string;
  requestedProvider?: string;
  requestedDateRange?: string;
  scheduledDateTime?: string;
  confirmationNumber?: string;
  reminderSent?: boolean;
  location?: string;
}

export interface RecordsRequest extends BaseTask {
  taskType: "records-request";
  requestingProviderName: string;
  requestingProviderFax?: string;
  requestingProviderPhone?: string;
  recordsDateRange?: string;
  recordTypes: string;
  authorizationOnFile: boolean;
  sentMethod?: "fax" | "mail" | "portal" | "pickup";
  sentAt?: string;
  denialReason?: string;
}

export interface Referral extends BaseTask {
  taskType: "referral";
  referredToProvider: string;
  referredToSpecialty: string;
  referredToPhone?: string;
  referredToFax?: string;
  referralReason: string;
  urgency: "routine" | "urgent" | "stat";
  referralNumber?: string;
  insuranceAuthRequired: boolean;
  authNumber?: string;
  appointmentScheduled?: boolean;
  appointmentDateTime?: string;
  denialReason?: string;
}

export type Task = PriorAuth | Prescription | ReturnCall | Scheduling | RecordsRequest | Referral;

// ─── API request/response shapes ─────────────────────────────────────────────

export interface CreateTaskRequest {
  taskType: TaskType;
  priority: Priority;
  patientId: string;
  patientName: string;
  patientDob: string;
  assignedTo?: string;
  notes: string;
  dueDate?: string;
  [key: string]: unknown;   // allow type-specific fields
}

export interface UpdateTaskRequest {
  taskId: string;
  status?: TaskStatus;
  priority?: Priority;
  assignedTo?: string;
  notes?: string;
  dueDate?: string;
  [key: string]: unknown;
}

export interface ListTasksQuery {
  taskType?: TaskType;
  status?: TaskStatus;
  assignedTo?: string;
  limit?: number;
  lastKey?: string;          // base64-encoded DynamoDB exclusive start key
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    nextKey?: string;
    count: number;
  };
}
