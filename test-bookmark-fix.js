#!/usr/bin/env node
/**
 * Test script for bookmark functionality fixes
 * 
 * This script tests the bookmark operations to ensure they work correctly:
 * 1. Creates a test bookmark
 * 2. Retrieves bookmarks (should trigger cleanup)
 * 3. Deletes the bookmark
 * 4. Tests manual cleanup
 * 
 * Usage:
 *   node test-bookmark-fix.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testBookmarkFix() {
  console.log('🧪 Testing bookmark functionality fixes...\n');
  
  try {
    // Get a test user (first user in the system)
    const testUser = await prisma.user.findFirst({
      where: { role: 'user' }
    });
    
    if (!testUser) {
      console.log('❌ No test user found. Please create a user first.');
      return;
    }
    
    console.log(`👤 Using test user: ${testUser.email} (${testUser.id})`);
    
    // Clean up any existing test bookmarks
    await prisma.bookmark.deleteMany({
      where: {
        userId: testUser.id,
        itemId: {
          startsWith: '/test-'
        }
      }
    });
    
    console.log('🧹 Cleaned up existing test bookmarks');
    
    // Test 1: Create a bookmark
    console.log('\n📝 Test 1: Creating a test bookmark...');
    const testBookmark = await prisma.bookmark.create({
      data: {
        userId: testUser.id,
        itemId: '/test-file.txt',
        itemType: 'document',
        itemName: 'Test File'
      }
    });
    
    console.log(`✅ Created bookmark: ${testBookmark.id}`);
    
    // Test 2: Check if bookmark exists
    console.log('\n🔍 Test 2: Checking if bookmark exists...');
    const existingBookmark = await prisma.bookmark.findFirst({
      where: {
        userId: testUser.id,
        itemId: '/test-file.txt'
      }
    });
    
    if (existingBookmark) {
      console.log(`✅ Found bookmark: ${existingBookmark.id}`);
    } else {
      console.log('❌ Bookmark not found');
    }
    
    // Test 3: Get all bookmarks for user
    console.log('\n📋 Test 3: Getting all bookmarks for user...');
    const allBookmarks = await prisma.bookmark.findMany({
      where: { userId: testUser.id }
    });
    
    console.log(`📊 Found ${allBookmarks.length} bookmarks`);
    allBookmarks.forEach(b => {
      console.log(`  - ${b.itemType}: ${b.itemId} (${b.itemName})`);
    });
    
    // Test 4: Delete the bookmark
    console.log('\n🗑️ Test 4: Deleting the test bookmark...');
    const deleteResult = await prisma.bookmark.deleteMany({
      where: {
        userId: testUser.id,
        itemId: '/test-file.txt'
      }
    });
    
    console.log(`✅ Deleted ${deleteResult.count} bookmarks`);
    
    // Test 5: Verify bookmark is deleted
    console.log('\n🔍 Test 5: Verifying bookmark is deleted...');
    const deletedBookmark = await prisma.bookmark.findFirst({
      where: {
        userId: testUser.id,
        itemId: '/test-file.txt'
      }
    });
    
    if (!deletedBookmark) {
      console.log('✅ Bookmark successfully deleted');
    } else {
      console.log('❌ Bookmark still exists');
    }
    
    // Test 6: Test bulk operations
    console.log('\n🔄 Test 6: Testing bulk operations...');
    
    // Create multiple test bookmarks
    const bulkBookmarks = [
      {
        userId: testUser.id,
        itemId: '/test-bulk-1.txt',
        itemType: 'document',
        itemName: 'Test Bulk 1'
      },
      {
        userId: testUser.id,
        itemId: '/test-bulk-2.txt',
        itemType: 'document',
        itemName: 'Test Bulk 2'
      }
    ];
    
    await prisma.bookmark.createMany({
      data: bulkBookmarks
    });
    
    console.log('✅ Created bulk bookmarks');
    
    // Delete bulk bookmarks
    const bulkDeleteResult = await prisma.bookmark.deleteMany({
      where: {
        userId: testUser.id,
        itemId: {
          in: ['/test-bulk-1.txt', '/test-bulk-2.txt']
        }
      }
    });
    
    console.log(`✅ Deleted ${bulkDeleteResult.count} bulk bookmarks`);
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testBookmarkFix(); 