import nodemailer from 'nodemailer';

if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn('Email configuration missing. Email functionality will be disabled.');
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) {
      console.log('Email service not configured. Email not sent.');
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to,
        subject,
        html
      });
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/verify-email?token=${token}`;
    
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <h2 style="color: #3b82f6;">Verify Your LoadLink Africa Account</h2>
        <p>Thank you for registering with LoadLink Africa. Please click the button below to verify your email address:</p>
        <a href="${verificationUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Verify Email</a>
        <p>If you didn't create an account with LoadLink Africa, please ignore this email.</p>
        <p>Best regards,<br>The LoadLink Africa Team</p>
      </div>
    `;

    return this.sendEmail(email, 'Verify Your LoadLink Africa Account', html);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password?token=${token}`;
    
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <h2 style="color: #3b82f6;">Reset Your Password</h2>
        <p>You requested to reset your password for your LoadLink Africa account. Click the button below to set a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Reset Password</a>
        <p>This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.</p>
        <p>Best regards,<br>The LoadLink Africa Team</p>
      </div>
    `;

    return this.sendEmail(email, 'Reset Your LoadLink Africa Password', html);
  }

  async sendJobNotificationEmail(email: string, jobTitle: string, jobDetails: any): Promise<boolean> {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <h2 style="color: #059669;">New Job Match Found!</h2>
        <p>A new job matching your criteria has been posted on LoadLink Africa:</p>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <h3 style="margin: 0 0 8px 0; color: #374151;">${jobTitle}</h3>
          <p style="margin: 4px 0;"><strong>Cargo:</strong> ${jobDetails.cargoType} - ${jobDetails.cargoWeight}kg</p>
          <p style="margin: 4px 0;"><strong>Route:</strong> ${jobDetails.pickupAddress} → ${jobDetails.deliveryAddress}</p>
          <p style="margin: 4px 0;"><strong>Payment:</strong> BWP ${jobDetails.paymentAmount}</p>
        </div>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard" style="display: inline-block; background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">View Job Details</a>
        <p>Best regards,<br>The LoadLink Africa Team</p>
      </div>
    `;

    return this.sendEmail(email, 'New Job Match - LoadLink Africa', html);
  }
}

export const emailService = new EmailService();
