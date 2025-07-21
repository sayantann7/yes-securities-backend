import bcrypt from 'bcrypt';
import { PrismaClient, User } from "../src/generated/prisma";

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
 * First deletes all related records to avoid foreign key constraints.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  // Get the user ID first
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true }
  });

  if (!user) {
    throw new Error(`User with email ${email} not found`);
  }

  // Delete related records first to avoid foreign key constraints
  await prisma.$transaction([
    // Delete comments
    prisma.comment.deleteMany({
      where: { userId: user.id }
    }),
    // Delete notifications
    prisma.notification.deleteMany({
      where: { userId: user.id }
    }),
    // Delete bookmarks
    prisma.bookmark.deleteMany({
      where: { userId: user.id }
    }),
    // Finally delete the user
    prisma.user.delete({
      where: { email }
    })
  ]);
}