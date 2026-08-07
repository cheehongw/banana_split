CREATE TABLE `expense_item_claims` (
	`item_id` text NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `expense_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense_items` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text DEFAULT 'item' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action
);
