\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','a@example.com','{"username":"alice","display_name":"Alice"}'),
 ('b0000000-0000-0000-0000-000000000002','b@example.com','{"username":"bob","display_name":"Bob"}');

\echo '--- 1. strangers cannot message (must fail: not_mutual_follow)'
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','hello');

\echo '--- 2. ONE-WAY follow is still not enough (must fail)'
insert into public.follows (follower_id, following_id)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','hello again');

\echo '--- 3. mutual follow: both directions now work'
insert into public.follows (follower_id, following_id)
 values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001');
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','hi bob');
insert into public.messages (sender_id, recipient_id, body)
 values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','hi alice');
select count(*) as messages_sent from public.messages;

\echo '--- 4. a BLOCK stops it even while mutual (must fail: blocked)'
insert into public.blocks (blocker_id, blocked_id)
 values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001');
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','let me in');
delete from public.blocks;

\echo '--- 5. UNFOLLOWING stops new messages (must fail), history survives'
delete from public.follows where follower_id = 'b0000000-0000-0000-0000-000000000002';
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','still there?');
select count(*) as history_kept from public.messages;

\echo '--- 6. nobody can message themselves (must fail)'
insert into public.follows (follower_id, following_id)
 values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001');
insert into public.messages (sender_id, recipient_id, body)
 values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','me');

\echo '--- 7. the anon key cannot read anyones messages (must return 0)'
set role anon; select count(*) as anon_can_read from public.messages; reset role;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select count(*) as authenticated_can_read from public.messages;
reset role;
