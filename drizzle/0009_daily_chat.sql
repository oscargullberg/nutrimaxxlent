ALTER TABLE "chat_threads" ADD COLUMN "log_date" date;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_log_date_unique" UNIQUE("log_date");