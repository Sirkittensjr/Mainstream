"""A dataset the size a small-but-real FayTarra would be."""
import json, uuid, random, urllib.request, sys
random.seed(7)
PORT = sys.argv[1]
N_USERS, N_POSTS, N_RATINGS, N_LIKES, N_COMMENTS, N_FOLLOWS, N_NOTES = 200, 600, 2500, 4000, 1200, 3000, 400
CATS = ['Gaming','Music','Art','Comedy','Sports','Fitness','Food','Photography','Life']

def iso(days_ago, i=0):
    return f"2026-0{9 - days_ago//30}-{max(1, 28 - days_ago%28):02d}T{i%24:02d}:{i%60:02d}:00Z"

users, posts, ratings, likes, comments, follows, notes = [], [], [], [], [], [], []
for i in range(N_USERS):
    users.append({'id': str(uuid.uuid4()), 'username': f'perf{i:03d}', 'display_name': f'Perf {i:03d}',
        'email': f'perf{i:03d}@example.com', 'bio': 'x'*80, 'avatar_url': None, 'location': None,
        'interests': [random.choice(CATS)], 'role': 'user', 'status': 'active', 'status_reason': None,
        'trusted': True, 'username_changed_at': None, 'created_at': iso(random.randint(1, 200), i),
        'last_active_at': iso(random.randint(0, 5), i)})
ids = [u['id'] for u in users]

for i in range(N_POSTS):
    posts.append({'id': str(uuid.uuid4()), 'author_id': random.choice(ids), 'caption': 'a post '*12,
        'media': [], 'category': random.choice(CATS), 'tags': [], 'views': random.randint(0, 900),
        'removed': False, 'removed_reason': None, 'created_at': iso(random.randint(0, 60), i)})
post_ids = [p['id'] for p in posts]
owner_of = {p['id']: p['author_id'] for p in posts}

seen = set()
for i in range(N_RATINGS):
    rater, target = random.choice(ids), random.choice(post_ids)
    if owner_of[target] == rater or (rater, target) in seen: continue
    seen.add((rater, target))
    ratings.append({'id': str(uuid.uuid4()), 'rater_id': rater, 'target_type': 'post', 'target_id': target,
        'owner_id': owner_of[target], 'score': random.randint(4, 10), 'reactions': [], 'weight': 1,
        'created_at': iso(random.randint(0, 60), i), 'updated_at': iso(random.randint(0, 40), i)})
seen = set()
for i in range(N_LIKES):
    u, p = random.choice(ids), random.choice(post_ids)
    if (u, p) in seen: continue
    seen.add((u, p))
    likes.append({'id': str(uuid.uuid4()), 'post_id': p, 'user_id': u, 'created_at': iso(random.randint(0, 60), i)})
for i in range(N_COMMENTS):
    comments.append({'id': str(uuid.uuid4()), 'post_id': random.choice(post_ids), 'user_id': random.choice(ids),
        'parent_id': None, 'body': 'nice work', 'removed': False, 'created_at': iso(random.randint(0, 60), i)})
seen = set()
for i in range(N_FOLLOWS):
    a, b = random.choice(ids), random.choice(ids)
    if a == b or (a, b) in seen: continue
    seen.add((a, b))
    follows.append({'id': str(uuid.uuid4()), 'follower_id': a, 'following_id': b, 'created_at': iso(random.randint(0, 120), i)})

payload = {'users': users, 'posts': posts, 'ratings': ratings, 'likes': likes,
           'comments': comments, 'follows': follows}
req = urllib.request.Request(f'http://127.0.0.1:{PORT}/__seed', data=json.dumps(payload).encode(),
                             headers={'content-type': 'application/json'})
urllib.request.urlopen(req)
print(f"seeded {len(users)} users, {len(posts)} posts, {len(ratings)} ratings, {len(likes)} likes, {len(comments)} comments, {len(follows)} follows")
