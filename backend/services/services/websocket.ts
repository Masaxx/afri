import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { storage } from '../../storage';
import { User } from '@shared/schema';

export class WebSocketService {
  private io: SocketIOServer;
  private userSockets: Map<number, string> = new Map(); // userId -> socketId

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      path: '/ws'
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          throw new Error('No token provided');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number };
        const user = await storage.getUserById(decoded.userId);
        
        if (!user) {
          throw new Error('Invalid user');
        }

        socket.data.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const user: User = socket.data.user;
      this.userSockets.set(user.id, socket.id);

      console.log(`User ${user.email} connected via WebSocket`);

      // Join user to their personal room for notifications
      socket.join(`user:${user.id}`);

      // Handle chat joining
      socket.on('join_chat', (chatId: string) => {
        socket.join(`chat:${chatId}`);
      });

      // Handle leaving chat
      socket.on('leave_chat', (chatId: string) => {
        socket.leave(`chat:${chatId}`);
      });

      // Handle sending messages
      socket.on('send_message', async (data: { chatId: string; content: string }) => {
        try {
          const { chatId, content } = data;
          const chatIdNum = parseInt(chatId, 10);
          
          if (isNaN(chatIdNum)) {
            socket.emit('error', { message: 'Invalid chat ID' });
            return;
          }
          
          // Add message to database
          const updatedChat = await storage.addMessage(chatIdNum, user.id, content);
          
          if (updatedChat) {
            // Broadcast message to all participants in the chat
            socket.to(`chat:${chatId}`).emit('new_message', {
              chatId,
              message: {
                senderId: user.id,
                content,
                timestamp: new Date(),
                read: false
              }
            });

            // Send notification to other participants
            for (const participantId of updatedChat.participants) {
              if (participantId !== user.id) {
                this.sendNotificationToUser(participantId, {
                  type: 'new_message',
                  title: 'New Message',
                  message: `New message from ${user.contactPersonName}`,
                  data: { chatId, senderId: user.id }
                });
              }
            }
          }
        } catch (error) {
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle typing indicators
      socket.on('typing', (data: { chatId: string; isTyping: boolean }) => {
        socket.to(`chat:${data.chatId}`).emit('user_typing', {
          userId: user.id,
          userName: user.contactPersonName,
          isTyping: data.isTyping
        });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.userSockets.delete(user.id);
        console.log(`User ${user.email} disconnected from WebSocket`);
      });
    });
  }

  // Send notification to specific user
  public sendNotificationToUser(userId: number, notification: {
    type: string;
    title: string;
    message: string;
    data?: any;
  }) {
    this.io.to(`user:${userId}`).emit('notification', notification);
  }

  // Send job update to all relevant users
  public sendJobUpdate(jobId: number, update: any) {
    this.io.emit('job_update', { jobId, ...update });
  }

  // Broadcast system announcement
  public broadcastAnnouncement(announcement: {
    title: string;
    message: string;
    type: 'info' | 'warning' | 'error';
  }) {
    this.io.emit('system_announcement', announcement);
  }

  public getIO(): SocketIOServer {
    return this.io;
  }
}
