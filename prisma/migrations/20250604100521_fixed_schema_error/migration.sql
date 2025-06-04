/*
  Warnings:

  - You are about to drop the column `recentDocs` on the `Comment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "recentDocs";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recentDocs" TEXT[];
