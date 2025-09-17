import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Stripe from 'stripe';
import { storage } from "./storage";
import { WebSocketService } from "@services/websocket";
import { emailService } from "@services/email";
import { authenticateToken, requireRole, requireSubscription, AuthRequest } from "@middleware/auth";
import { 
  loginSchema, 
  registerTruckingSchema, 
  registerShippingSchema, 
  insertJobSchema,
  UserRole,
  JobStatus 
} from "@shared/schema";
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('JWT_SECRET not set. Using development secret.');
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY not set. Payment functionality will be disabled.');
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
}) : null;

// Configure multer for file uploads
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer with proper types
const upload = multer({
  storage: multer.diskStorage({
    destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
      cb(null, uploadDir);
    },
    filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.'));
    }
  }
});


export async function registerRoutes(app: Express): Promise<Server> {
  // Database connection handled by Drizzle DB

  const httpServer = createServer(app);
  
  // Initialize WebSocket service
  const wsService = new WebSocketService(httpServer);

  // Serve uploaded files
  app.use('/uploads', authenticateToken, (req, res, next) => {
    // Add access control logic here if needed
    next();
  }, (req, res, next) => {
    const filePath = path.join(uploadDir, req.url);
    if (fs.existsSync(filePath)) {
      res.sendFile(path.resolve(filePath));
    } else {
      res.status(404).json({ message: 'File not found' });
    }
  });

  // Auth routes
  app.post('/api/auth/register/trucking', async (req, res) => {
    try {
      const validatedData = registerTruckingSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedData.email);
      if (existingUser) {
        return res.status(409).json({ message: 'Email already registered' });
      }

      // Create user
      const user = await storage.createUser({
        ...validatedData,
        role: UserRole.TRUCKING_COMPANY,
        emailVerificationToken: crypto.randomBytes(32).toString('hex'),
        subscriptionStatus: 'trial'
      });

      // Send verification email
      if (user.emailVerificationToken) {
        await emailService.sendVerificationEmail(user.email, user.emailVerificationToken);
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({
        message: 'Registration successful. Please check your email for verification.',
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          companyName: user.companyName,
          subscriptionStatus: user.subscriptionStatus
        }
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(400).json({ message: error.message || 'Registration failed' });
    }
  });

  app.post('/api/auth/register/shipping', async (req, res) => {
    try {
      const validatedData = registerShippingSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedData.email);
      if (existingUser) {
        return res.status(409).json({ message: 'Email already registered' });
      }

      // Create user
      const user = await storage.createUser({
        ...validatedData,
        role: UserRole.SHIPPING_ENTITY,
        emailVerificationToken: crypto.randomBytes(32).toString('hex'),
        subscriptionStatus: 'active' // Shipping entities get free access
      });

      // Send verification email
      if (user.emailVerificationToken) {
        await emailService.sendVerificationEmail(user.email, user.emailVerificationToken);
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({
        message: 'Registration successful. Please check your email for verification.',
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          companyName: user.companyName,
          subscriptionStatus: user.subscriptionStatus
        }
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(400).json({ message: error.message || 'Registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      // Find user
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          companyName: user.companyName,
          subscriptionStatus: user.subscriptionStatus,
          emailVerified: user.emailVerified
        }
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(400).json({ message: error.message || 'Login failed' });
    }
  });

  app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res) => {
    res.json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        role: req.user!.role,
        companyName: req.user!.companyName,
        contactPersonName: req.user!.contactPersonName,
        subscriptionStatus: req.user!.subscriptionStatus,
        emailVerified: req.user!.emailVerified
      }
    });
  });

  // Document upload route
  app.post('/api/auth/upload-documents', authenticateToken, upload.array('documents', 5), async (req: AuthRequest, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
      }

      const documents = (req.files as Express.Multer.File[]).map(file => ({
        filename: file.originalname,
        fileUrl: `/uploads/${file.filename}`,
        verified: false
      }));

      await storage.updateUser(req.user!.id, { documents });
      const updatedUser = await storage.getUserById(req.user!.id);

      res.json({ 
        message: 'Documents uploaded successfully',
        documents: updatedUser?.documents || []
      });
    } catch (error: any) {
      console.error('Document upload error:', error);
      res.status(500).json({ message: 'Document upload failed' });
    }
  });

  // Job routes
  app.post('/api/jobs', authenticateToken, requireRole([UserRole.SHIPPING_ENTITY]), async (req: AuthRequest, res) => {
    try {
      const jobData = insertJobSchema.parse({
        ...req.body,
        shipperId: req.user!.id,
        pickupDate: new Date(req.body.pickupDate),
        deliveryDeadline: new Date(req.body.deliveryDeadline)
      });

      const job = await storage.createJob(jobData);

      // Notify relevant trucking companies
      wsService.sendJobUpdate(job.id, {
        type: 'new_job',
        job
      });

      res.status(201).json({ message: 'Job posted successfully', job });
    } catch (error: any) {
      console.error('Job creation error:', error);
      res.status(400).json({ message: error.message || 'Failed to create job' });
    }
  });

  app.get('/api/jobs', authenticateToken, requireSubscription, async (req: AuthRequest, res) => {
    try {
      const { 
        status, 
        cargoType, 
        industry, 
        pickupCountry, 
        deliveryCountry,
        page = '1',
        limit = '20'
      } = req.query;

      const filters: any = {};
      if (status) filters.status = status;
      if (cargoType) filters.cargoType = cargoType;
      if (industry) filters.industry = industry;
      if (pickupCountry) filters.pickupCountry = pickupCountry;
      if (deliveryCountry) filters.deliveryCountry = deliveryCountry;

      // For trucking companies, only show available jobs
      if (req.user!.role === UserRole.TRUCKING_COMPANY) {
        filters.status = JobStatus.AVAILABLE;
      }

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const jobs = await storage.getJobs({ ...filters, limit: limitNum, offset: skip });

      res.json({ jobs });
    } catch (error: any) {
      console.error('Jobs fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch jobs' });
    }
  });

  app.get('/api/jobs/my', authenticateToken, async (req: AuthRequest, res) => {
    try {
      let jobs;
      if (req.user!.role === UserRole.SHIPPING_ENTITY) {
        jobs = await storage.getJobsByShipper(req.user!.id);
      } else if (req.user!.role === UserRole.TRUCKING_COMPANY) {
        jobs = await storage.getJobsByCarrier(req.user!.id);
      } else {
        return res.status(403).json({ message: 'Access denied' });
      }

      res.json({ jobs });
    } catch (error: any) {
      console.error('My jobs fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch your jobs' });
    }
  });

  app.patch('/api/jobs/:id/take', authenticateToken, requireRole([UserRole.TRUCKING_COMPANY]), requireSubscription, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const job = await storage.takeJob(id, req.user!.id);

      if (!job) {
        return res.status(404).json({ message: 'Job not found or already taken' });
      }

      // Notify shipper
      wsService.sendNotificationToUser(job.shipperId, {
        type: 'job_taken',
        title: 'Job Taken',
        message: `Your job has been taken by ${req.user!.companyName}`,
        data: { jobId: job.id }
      });

      res.json({ message: 'Job taken successfully', job });
    } catch (error: any) {
      console.error('Job take error:', error);
      res.status(500).json({ message: 'Failed to take job' });
    }
  });

  app.patch('/api/jobs/:id/complete', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const job = await storage.getJobById(id);

      if (!job) {
        return res.status(404).json({ message: 'Job not found' });
      }

      // Check permissions
      if (req.user!.role === UserRole.SHIPPING_ENTITY && job.shipperId !== req.user!.id) {
        return res.status(403).json({ message: 'Not authorized to complete this job' });
      } else if (req.user!.role === UserRole.TRUCKING_COMPANY && job.carrierId !== req.user!.id) {
        return res.status(403).json({ message: 'Not authorized to complete this job' });
      }

      const completedJob = await storage.completeJob(id);

      // Notify relevant parties
      if (req.user!.role === UserRole.SHIPPING_ENTITY && completedJob?.carrierId) {
        wsService.sendNotificationToUser(completedJob.carrierId, {
          type: 'job_completed',
          title: 'Job Completed',
          message: `Job has been marked as completed by ${req.user!.companyName}`,
          data: { jobId: completedJob.id }
        });
      } else if (req.user!.role === UserRole.TRUCKING_COMPANY) {
        wsService.sendNotificationToUser(completedJob!.shipperId, {
          type: 'job_completed',
          title: 'Job Completed',
          message: `Job has been marked as completed by ${req.user!.companyName}`,
          data: { jobId: completedJob!.id }
        });
      }

      res.json({ message: 'Job completed successfully', job: completedJob });
    } catch (error: any) {
      console.error('Job complete error:', error);
      res.status(500).json({ message: 'Failed to complete job' });
    }
  });

  // Chat routes
  app.get('/api/chats', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const chats = await storage.getChatsByUser(req.user!.id);
      res.json({ chats });
    } catch (error: any) {
      console.error('Chats fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch chats' });
    }
  });

  app.get('/api/chats/job/:jobId', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { jobId } = req.params;
      let chat = await storage.getChatByJobId(jobId);

      if (!chat) {
        // Get job to find participants
        const job = await storage.getJobById(jobId);
        if (!job) {
          return res.status(404).json({ message: 'Job not found' });
        }

        // Create chat if it doesn't exist
        const participants = [job.shipperId];
        if (job.carrierId) {
          participants.push(job.carrierId);
        }

        if (!participants.includes(req.user!.id)) {
          return res.status(403).json({ message: 'Not authorized to access this chat' });
        }

        chat = await storage.createChat({
          jobId,
          participants,
          messages: []
        });
      }

      // Check if user is participant
      if (!chat.participants.includes(req.user!.id)) {
        return res.status(403).json({ message: 'Not authorized to access this chat' });
      }

      res.json({ chat });
    } catch (error: any) {
      console.error('Chat fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch chat' });
    }
  });

  app.patch('/api/chats/:id/read', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const success = await storage.markMessagesAsRead(id, req.user!.id);

      if (!success) {
        return res.status(404).json({ message: 'Chat not found' });
      }

      res.json({ message: 'Messages marked as read' });
    } catch (error: any) {
      console.error('Mark read error:', error);
      res.status(500).json({ message: 'Failed to mark messages as read' });
    }
  });

  // Notification routes
  app.get('/api/notifications', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { limit = '50' } = req.query;
      const notifications = await storage.getNotificationsByUser(req.user!.id, parseInt(limit as string));
      res.json({ notifications });
    } catch (error: any) {
      console.error('Notifications fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  });

  app.patch('/api/notifications/:id/read', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const success = await storage.markNotificationAsRead(id);

      if (!success) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      res.json({ message: 'Notification marked as read' });
    } catch (error: any) {
      console.error('Mark notification read error:', error);
      res.status(500).json({ message: 'Failed to mark notification as read' });
    }
  });

  // Payment routes (Stripe integration)
  if (stripe) {
    app.post('/api/payments/create-subscription', authenticateToken, requireRole([UserRole.TRUCKING_COMPANY]), async (req: AuthRequest, res) => {
      try {
        const user = req.user!;

        // If user already has a subscription, return existing one
        if (user.stripeSubscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          if (subscription.status === 'active') {
            return res.json({
              message: 'Subscription already active',
              subscriptionId: subscription.id
            });
          }
        }

        // Create Stripe customer if doesn't exist
        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name: user.companyName || user.contactPersonName,
            metadata: {
              userId: user.id!
            }
          });
          customerId = customer.id;
          await storage.updateUser(user.id!, { stripeCustomerId: customerId });
        }

        // Create subscription
        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{
            price_data: {
              currency: 'usd', // Using USD instead of BWP for Stripe compatibility
              product_data: {
                name: 'LoadLink Africa Trucking Subscription',
                description: 'Monthly subscription for trucking companies'
              },
              unit_amount: 2000, // $20 USD equivalent to BWP 500
              recurring: {
                interval: 'month'
              }
            }
          }],
          payment_behavior: 'default_incomplete',
          expand: ['latest_invoice.payment_intent'],
        });

        // Update user with subscription info
        await storage.updateUserSubscription(user.id!, {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: 'active',
          subscriptionExpiresAt: new Date(subscription.current_period_end * 1000)
        });

        res.json({
          message: 'Subscription created successfully',
          subscriptionId: subscription.id,
          clientSecret: subscription.latest_invoice?.payment_intent?.client_secret
        });
      } catch (error: any) {
        console.error('Subscription creation error:', error);
        res.status(500).json({ message: 'Failed to create subscription' });
      }
    });

    app.post('/api/payments/webhook', async (req, res) => {
      const sig = req.headers['stripe-signature'] as string;
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
      } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle the event
      switch (event.type) {
        case 'invoice.payment_succeeded':
          const invoice = event.data.object;
          if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
            const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
            
            if (customer.metadata?.userId) {
              await storage.updateUserSubscription(parseInt(customer.metadata.userId), {
                subscriptionStatus: 'active',
                subscriptionExpiresAt: new Date(subscription.current_period_end * 1000)
              });
            }
          }
          break;

        case 'invoice.payment_failed':
          // Handle failed payment
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object;
          const deletedCustomer = await stripe.customers.retrieve(deletedSubscription.customer as string) as Stripe.Customer;
          
          if (deletedCustomer.metadata?.userId) {
            await storage.updateUserSubscription(parseInt(deletedCustomer.metadata.userId), {
              subscriptionStatus: 'inactive',
              subscriptionExpiresAt: new Date()
            });
          }
          break;

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    });
  }

  // Admin routes
  app.get('/api/admin/dashboard', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const stats = {
        totalUsers: await storage.getUserCount(),
        truckingCompanies: await storage.getUserCount(UserRole.TRUCKING_COMPANY),
        shippingEntities: await storage.getUserCount(UserRole.SHIPPING_ENTITY),
        totalJobs: await storage.getJobCount(),
        activeJobs: await storage.getJobCount(JobStatus.AVAILABLE),
        completedJobs: await storage.getJobCount(JobStatus.COMPLETED),
        monthlyRevenue: await storage.getMonthlyRevenue()
      };

      res.json({ stats });
    } catch (error: any) {
      console.error('Admin dashboard error:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard data' });
    }
  });

  // Admin user management routes
  app.get('/api/admin/users', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const { role, verified, hasDocuments, page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const users = await storage.getAllUsers({
        role: role as string,
        verified: verified === 'true' ? true : verified === 'false' ? false : undefined,
        hasDocuments: hasDocuments === 'true' ? true : hasDocuments === 'false' ? false : undefined,
        limit: Number(limit),
        offset: offset
      });

      res.json({ users });
    } catch (error: any) {
      console.error('Admin users error:', error);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  app.get('/api/admin/users/pending-documents', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const users = await storage.getUsersWithPendingDocuments();
      res.json({ users });
    } catch (error: any) {
      console.error('Admin pending documents error:', error);
      res.status(500).json({ message: 'Failed to fetch users with pending documents' });
    }
  });

  app.post('/api/admin/users/:userId/verify-documents', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { approved, notes } = req.body;

      await storage.verifyUserDocuments(Number(userId), req.user!.id, approved, notes);
      
      res.json({ 
        message: approved ? 'Documents approved successfully' : 'Documents rejected',
        approved 
      });
    } catch (error: any) {
      console.error('Admin verify documents error:', error);
      res.status(500).json({ message: 'Failed to process document verification' });
    }
  });

  // Admin dispute management routes
  app.get('/api/admin/disputes', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const { status, adminId, page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const disputes = await storage.getDisputes({
        status: status as string,
        adminId: adminId ? Number(adminId) : undefined,
        limit: Number(limit),
        offset: offset
      });

      res.json({ disputes });
    } catch (error: any) {
      console.error('Admin disputes error:', error);
      res.status(500).json({ message: 'Failed to fetch disputes' });
    }
  });

  app.post('/api/admin/disputes/:disputeId/assign', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const { disputeId } = req.params;

      await storage.assignDisputeToAdmin(Number(disputeId), req.user!.id);
      
      res.json({ message: 'Dispute assigned successfully' });
    } catch (error: any) {
      console.error('Admin assign dispute error:', error);
      res.status(500).json({ message: 'Failed to assign dispute' });
    }
  });

  app.post('/api/admin/disputes/:disputeId/resolve', authenticateToken, requireRole([UserRole.SUPER_ADMIN, UserRole.CUSTOMER_SUPPORT]), async (req: AuthRequest, res) => {
    try {
      const { disputeId } = req.params;
      const { resolution } = req.body;

      await storage.resolveDispute(Number(disputeId), resolution, req.user!.id);
      
      res.json({ message: 'Dispute resolved successfully' });
    } catch (error: any) {
      console.error('Admin resolve dispute error:', error);
      res.status(500).json({ message: 'Failed to resolve dispute' });
    }
  });

  // User dispute creation route
  app.post('/api/disputes', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { jobId, reportedUserId, title, description, evidence } = req.body;

      const dispute = await storage.createDispute({
        jobId,
        reporterId: req.user!.id,
        reportedUserId,
        title,
        description,
        evidence: evidence || []
      });

      res.status(201).json({ dispute });
    } catch (error: any) {
      console.error('Create dispute error:', error);
      res.status(500).json({ message: 'Failed to create dispute' });
    }
  });

  return httpServer;
}
