import { PrismaClient } from "@prisma/client";

async function createAdminUser() {
  const prisma = new PrismaClient();
  
  try {
    
    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'dishant.jain@ysil.in',
        fullname: 'Dishant Jain',
        password: 'admin123456',
        role: 'admin',
        recentDocs: [],
        numberOfSignIns: 0,
        timeSpent: 0,
        documentsViewed: 0
      }
    });
    
    console.log('✅ Admin user created successfully!');
    console.log('📧 Email:', admin.email);
    console.log('🔑 Password: admin123456');
    console.log('👤 Role:', admin.role);
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();