import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { PrismaClient } from "../src/generated/prisma";
import { deleteUserByEmail } from './services';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const prisma = new PrismaClient();

//@ts-ignore
router.post('/users/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Missing employee list file' });
      }

      // Parse the uploaded Excel file
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const uploadedEmployees: Array<{ fullname?: string; email: string; 'ad-id'?: string }> =
        xlsx.utils.sheet_to_json(sheet);

      // Get all current non-admin users from the database
      const currentUsers = await prisma.user.findMany({
        where: {
          role: {
            not: "admin"
          }
        },
        select: {
          id: true,
          email: true
        }
      });

      const results = {
        added: 0,
        removed: 0,
        unchanged: 0,
        errors: [] as string[]
      };

      // Create a set of all uploaded email addresses for quick lookup
      const uploadedEmails = new Set(
        uploadedEmployees
          .map(emp => emp.email?.trim().toLowerCase())
          .filter(email => !!email)
      );

      // Create a map of current users by email for quick lookup
      const currentUsersByEmail = new Map(
        currentUsers.map(user => [user.email.toLowerCase(), user])
      );

      // 1. Handle users to be removed (in database but not in uploaded list)
      for (const [email, user] of currentUsersByEmail.entries()) {
        if (!uploadedEmails.has(email)) {
          try {
            await deleteUserByEmail(email);
            results.removed++;
          } catch (err: any) {
            results.errors.push(`Failed to remove user ${email}: ${err.message || err}`);
          }
        } else {
          results.unchanged++;
        }
      }

      // 2. Handle users to be added (in uploaded list but not in database)
      for (const employee of uploadedEmployees) {
        const email = employee.email?.trim().toLowerCase();
        const fullname = employee.fullname?.trim() || '';
        const adId = employee['ad-id']?.trim();
        
        if (!email) {
          results.errors.push(`Missing email in uploaded file`);
          continue;
        }

        if (!adId) {
          results.errors.push(`Missing ad-id for user ${email} in uploaded file`);
          continue;
        }

        if (!currentUsersByEmail.has(email)) {
          try {
            // Store ad-id directly as password without hashing
            await prisma.user.create({
              data: {
                fullname,
                email,
                password: adId,
                role: 'user',
              },
            });
            
            results.added++;
          } catch (err: any) {
            results.errors.push(`Failed to add user ${email}: ${err.message || err}`);
          }
        }
      }

      return res.json({
        message: "Employee list processed successfully",
        results: {
          newEmployeesAdded: results.added,
          formerEmployeesRemoved: results.removed,
          unchangedEmployees: results.unchanged,
          errors: results.errors
        }
      });
    } catch (err: any) {
      console.error('Import error:', err);
      return res.status(500).json({ error: err.message || 'Import failed' });
    }
  }
);

export default router;