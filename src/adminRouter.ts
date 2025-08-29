import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { prisma } from "./prisma";
import { deleteUserByEmail } from './services';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper to safely normalize any cell value to a trimmed string
function norm(val: any): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

// Accept both XLSX and CSV uploads; parse & diff users
// @ts-ignore
router.post('/users/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Missing employee list file' });
      }

      // Parse the uploaded file (supports .xlsx / .csv via xlsx library)
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const uploadedEmployees: Array<Record<string, any>> = xlsx.utils.sheet_to_json(sheet, {
        defval: '', // keep empty strings instead of undefined
        blankrows: false
      });

      // Normalize records with flexible header names (case / dash variants)
      // Determine header row & map column letters to header names for direct cell access
      const sheetRange = xlsx.utils.decode_range(sheet['!ref'] as string);
      const headerRowIndex = sheetRange.s.r; // usually 0
      const headerMap: Record<string,string> = {}; // lowercased header name -> column letter
      for (let c = sheetRange.s.c; c <= sheetRange.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r: headerRowIndex, c });
        const cell = sheet[addr];
        if (!cell) continue;
        const headerName = String(cell.v || '').trim().toLowerCase();
        if (headerName) {
          const colLetter = addr.replace(/\d+/g,'');
          headerMap[headerName] = colLetter;
        }
      }
      const adIdHeaderCandidates = ['ad-id','adid','ad id','ad_id','adid'];
      const adIdColumnLetter = adIdHeaderCandidates.map(h=>headerMap[h]).find(Boolean);

      const normalized = uploadedEmployees.map((row, idx) => {
        const emailRaw = row.email ?? row.Email ?? row['E-mail'] ?? row['e-mail'] ?? row['EMAIL'];
        const fullnameRaw = row.fullname ?? row['full name'] ?? row['Full Name'] ?? row['Full_Name'] ?? row['FULLNAME'] ?? row['name'] ?? row['Name'];
        let adIdRaw = row['ad-id'] ?? row['AD-ID'] ?? row['adid'] ?? row['ADID'] ?? row['AdId'] ?? row['Ad-ID'];
        // Attempt to recover leading zeros using the raw cell text (formatted) if column identified
        if (adIdColumnLetter) {
          const sheetRowNumber = headerRowIndex + 1 + idx + 1; // +1 to move past header, +1 because sheet rows are 1-based
            const cellAddress = `${adIdColumnLetter}${sheetRowNumber}`;
          const cellObj = sheet[cellAddress];
          const rawText = cellObj?.w ?? cellObj?.v;
          if (rawText !== undefined && rawText !== null) {
            const rawStr = String(rawText).trim();
            // Prefer formatted text if it preserves leading zeros
            if (/^0+\d+$/.test(rawStr) || (typeof adIdRaw === 'number')) {
              adIdRaw = rawStr; // keep leading zeros
            }
          }
        }
        return {
          fullname: norm(fullnameRaw),
          email: norm(emailRaw),
          adId: typeof adIdRaw === 'number' ? String(adIdRaw) : norm(adIdRaw)
        };
      }).filter(r => r.email);

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
        normalized
          .map(emp => norm(emp.email).toLowerCase())
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
      for (const employee of normalized) {
        const email = norm(employee.email).toLowerCase();
        const fullname = norm(employee.fullname);
  // Preserve leading zeros exactly for AD ID (only trim outer whitespace)
  const adId = (employee.adId ?? '').toString().trim();

        if (!email) {
          results.errors.push('Missing email in uploaded file row');
          continue;
        }
        if (!adId) {
          results.errors.push(`Missing ad-id for user ${email} in uploaded file`);
          continue;
        }
        if (!currentUsersByEmail.has(email)) {
          try {
            await prisma.user.create({
              data: {
                fullname,
                email: email.toLowerCase(),
                password: adId, // preserve leading zeros
                role: 'user'
              }
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