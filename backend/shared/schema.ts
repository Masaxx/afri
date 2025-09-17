import { z } from "zod";
import { pgTable, serial, text, varchar, integer, boolean, timestamp, json, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum('user_role', ['trucking_company', 'shipping_entity', 'super_admin', 'customer_support']);
export const cargoTypeEnum = pgEnum('cargo_type', ['general', 'refrigerated', 'hazardous', 'bulk', 'containers']);
export const industryEnum = pgEnum('industry', ['agriculture', 'manufacturing', 'retail', 'mining', 'logistics', 'construction']);
export const jobStatusEnum = pgEnum('job_status', ['available', 'taken', 'completed']);
export const countryEnum = pgEnum('country', ['BWA', 'ZAF', 'NAM', 'ZWE', 'ZMB']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'inactive', 'trial']);
export const notificationTypeEnum = pgEnum('notification_type', ['job_match', 'job_taken', 'job_completed', 'payment_confirmed', 'subscription_expiring']);
export const disputeStatusEnum = pgEnum('dispute_status', ['open', 'in_review', 'resolved', 'closed']);

// User roles
export const UserRole = {
  TRUCKING_COMPANY: 'trucking_company',
  SHIPPING_ENTITY: 'shipping_entity',
  SUPER_ADMIN: 'super_admin',
  CUSTOMER_SUPPORT: 'customer_support'
} as const;

export type UserRoleType = typeof UserRole[keyof typeof UserRole];

// Cargo types
export const CargoType = {
  GENERAL: 'general',
  REFRIGERATED: 'refrigerated',
  HAZARDOUS: 'hazardous',
  BULK: 'bulk',
  CONTAINERS: 'containers'
} as const;

export type CargoTypeType = typeof CargoType[keyof typeof CargoType];

// Industries
export const Industry = {
  AGRICULTURE: 'agriculture',
  MANUFACTURING: 'manufacturing',
  RETAIL: 'retail',
  MINING: 'mining',
  LOGISTICS: 'logistics',
  CONSTRUCTION: 'construction'
} as const;

export type IndustryType = typeof Industry[keyof typeof Industry];

// Job status
export const JobStatus = {
  AVAILABLE: 'available',
  TAKEN: 'taken',
  COMPLETED: 'completed'
} as const;

export type JobStatusType = typeof JobStatus[keyof typeof JobStatus];

// Countries
export const Country = {
  BOTSWANA: 'BWA',
  SOUTH_AFRICA: 'ZAF',
  NAMIBIA: 'NAM',
  ZIMBABWE: 'ZWE',
  ZAMBIA: 'ZMB'
} as const;

export type CountryType = typeof Country[keyof typeof Country];

// Database Tables
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  role: userRoleEnum('role').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  verified: boolean('verified').notNull().default(false),
  
  // Common fields
  companyName: varchar('company_name', { length: 255 }),
  contactPersonName: varchar('contact_person_name', { length: 255 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 50 }).notNull(),
  physicalAddress: text('physical_address').notNull(),
  country: countryEnum('country').notNull().default('BWA'),
  businessRegistrationNumber: varchar('business_registration_number', { length: 100 }),
  
  // Trucking company specific
  fleetSize: integer('fleet_size'),
  cargoTypes: json('cargo_types').$type<string[]>(),
  documents: json('documents').$type<Array<{
    filename: string;
    fileUrl: string;
    verified: boolean;
  }>>(),
  
  // Subscription fields
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('inactive'),
  subscriptionExpiresAt: timestamp('subscription_expires_at'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  
  // Security fields
  emailVerified: boolean('email_verified').notNull().default(false),
  emailVerificationToken: varchar('email_verification_token', { length: 255 }),
  passwordResetToken: varchar('password_reset_token', { length: 255 }),
  passwordResetExpires: timestamp('password_reset_expires'),
  loginAttempts: integer('login_attempts').notNull().default(0),
  accountLocked: boolean('account_locked').notNull().default(false),
  lockExpires: timestamp('lock_expires'),
  
  // Timestamps
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`)
});

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  shipperId: integer('shipper_id').notNull().references(() => users.id),
  carrierId: integer('carrier_id').references(() => users.id),
  
  // Cargo details
  cargoType: cargoTypeEnum('cargo_type').notNull(),
  cargoWeight: integer('cargo_weight').notNull(), // in kg
  cargoVolume: integer('cargo_volume').notNull(), // in m³
  industry: industryEnum('industry').notNull(),
  
  // Locations
  pickupAddress: text('pickup_address').notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  pickupCountry: countryEnum('pickup_country').notNull(),
  deliveryCountry: countryEnum('delivery_country').notNull(),
  
  // Schedule
  pickupDate: timestamp('pickup_date').notNull(),
  deliveryDeadline: timestamp('delivery_deadline').notNull(),
  
  // Payment
  paymentAmount: integer('payment_amount').notNull(), // in BWP
  paymentTerms: text('payment_terms').notNull(),
  
  // Requirements
  specialHandling: text('special_handling'),
  insuranceRequired: boolean('insurance_required').notNull().default(false),
  notes: text('notes'),
  
  // Status
  status: jobStatusEnum('status').notNull().default('available'),
  
  // Timestamps
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  takenAt: timestamp('taken_at'),
  completedAt: timestamp('completed_at')
});

export const chats = pgTable('chats', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  participants: json('participants').$type<number[]>().notNull(),
  messages: json('messages').$type<Array<{
    senderId: number;
    content: string;
    timestamp: Date;
    read: boolean;
  }>>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`)
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  data: json('data').$type<Record<string, any>>(),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().default(sql`now()`)
});

export const ratings = pgTable('ratings', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  raterId: integer('rater_id').notNull().references(() => users.id),
  ratedUserId: integer('rated_user_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`)
});

export const disputes = pgTable('disputes', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  reporterId: integer('reporter_id').notNull().references(() => users.id),
  reportedUserId: integer('reported_user_id').references(() => users.id),
  adminId: integer('admin_id').references(() => users.id),
  status: disputeStatusEnum('status').notNull().default('open'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  evidence: json('evidence').$type<Array<{
    type: 'document' | 'image' | 'message';
    url: string;
    description?: string;
  }>>().default([]),
  adminNotes: text('admin_notes'),
  resolution: text('resolution'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  resolvedAt: timestamp('resolved_at')
});

// Drizzle schemas and types
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertJobSchema = createInsertSchema(jobs);
export const selectJobSchema = createSelectSchema(jobs);
export const insertChatSchema = createInsertSchema(chats);
export const selectChatSchema = createSelectSchema(chats);
export const insertNotificationSchema = createInsertSchema(notifications);
export const selectNotificationSchema = createSelectSchema(notifications);
export const insertRatingSchema = createInsertSchema(ratings);
export const selectRatingSchema = createSelectSchema(ratings);
export const insertDisputeSchema = createInsertSchema(disputes);
export const selectDisputeSchema = createSelectSchema(disputes);

export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;
export type SelectJob = typeof jobs.$inferSelect;
export type InsertChat = typeof chats.$inferInsert;
export type SelectChat = typeof chats.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type SelectNotification = typeof notifications.$inferSelect;
export type InsertRating = typeof ratings.$inferInsert;
export type SelectRating = typeof ratings.$inferSelect;
export type InsertDispute = typeof disputes.$inferInsert;
export type SelectDispute = typeof disputes.$inferSelect;

// Legacy types for compatibility
export type User = SelectUser;
export type Job = SelectJob;
export type Chat = SelectChat;
export type Notification = SelectNotification;
export type Rating = SelectRating;
export type Dispute = SelectDispute;

// Login schemas
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export const registerTruckingSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  contactPersonName: z.string().min(1),
  companyName: z.string().min(1),
  phoneNumber: z.string().min(1),
  physicalAddress: z.string().min(1),
  businessRegistrationNumber: z.string().min(1),
  fleetSize: z.number().min(1),
  cargoTypes: z.array(z.enum([CargoType.GENERAL, CargoType.REFRIGERATED, CargoType.HAZARDOUS, CargoType.BULK, CargoType.CONTAINERS])).min(1),
  country: z.enum([Country.BOTSWANA, Country.SOUTH_AFRICA, Country.NAMIBIA, Country.ZIMBABWE, Country.ZAMBIA]).default(Country.BOTSWANA)
});

export const registerShippingSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  contactPersonName: z.string().min(1),
  companyName: z.string().min(1),
  phoneNumber: z.string().min(1),
  physicalAddress: z.string().min(1),
  businessRegistrationNumber: z.string().optional(),
  country: z.enum([Country.BOTSWANA, Country.SOUTH_AFRICA, Country.NAMIBIA, Country.ZIMBABWE, Country.ZAMBIA]).default(Country.BOTSWANA)
});

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterTruckingData = z.infer<typeof registerTruckingSchema>;
export type RegisterShippingData = z.infer<typeof registerShippingSchema>;
