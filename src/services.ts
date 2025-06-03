import bcrypt from 'bcrypt';
import { PrismaClient, User } from "../src/generated/prisma";
import nodemailer from 'nodemailer';

const SALT_ROUNDS = 10;

const prisma = new PrismaClient();

export interface NewUserInput {
  fullname: string;
  email: string;
  password: string;
}

/**
 * Creates a new user in the database with a hashed password.
 */
export async function createUser(input: NewUserInput): Promise<User> {
  const { fullname, email, password } = input;
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  return prisma.user.create({
    data: {
      fullname,
      email,
      password: hashedPassword,
      role: 'user',
    },
  });
}

/**
 * Deletes a user (or marks inactive) by their email.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  await prisma.user.delete({
    where: { email },
  });
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +process.env.SMTP_PORT!,
  secure: !!process.env.SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send welcome email with generated password.
 */
export async function sendWelcomeEmail(
  to: string,
  password: string
): Promise<void> {
  const mailOptions = {
    from: `"Your App Name" <${process.env.SMTP_FROM}>`,
    to,
    subject: 'Welcome to the App',
    text: `
Hi there,

Your account has been created. You can log in with:

  Email: ${to}
  Password: ${password}

Please change your password after logging in.

Thanks,
The Team
    `,
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Notify user of account removal.
 */
export async function sendRemovalNotice(to: string): Promise<void> {
  const mailOptions = {
    from: `"Your App Name" <${process.env.SMTP_FROM}>`,
    to,
    subject: 'Your Account Has Been Removed',
    text: `
Hello,

This is to inform you that your access to the app has been revoked
as you are no longer with the company.

If you believe this is a mistake, please contact the administrator.

Regards,
The Team
    `,
  };

  await transporter.sendMail(mailOptions);
}