/**
 * Seeds a demo friendship so the app can be explored without inventing data.
 *
 * Runs against whatever MONGO_URI points at. With the in-memory database this
 * has to run inside the same process as the server (the DB dies with it), so
 * the useful way to use this is SEED=1 on the dev server — see index.js.
 */
import { User } from '../models/User.js';
import { Friendship, sortPair } from '../models/Friendship.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { registerUser } from '../services/auth.service.js';
import * as timeline from '../services/timeline.service.js';
import { log } from '../lib/logger.js';

const PASSWORD = 'demo-password-1234';

const SCRIPT = [
  ['a', 'hey — good game earlier. that rook endgame was brutal'],
  ['b', 'you had me until move 34 honestly 😭'],
  ['a', 'i keep hanging pawns in time trouble'],
  ['b', 'same. want to go again tonight?'],
  ['a', 'yes. 10+0?'],
  ['b', 'perfect ♟'],
  ['b', 'also have you heard afreen afreen? the nusrat one'],
  ['a', 'on loop for three days now'],
];

export async function seed() {
  if (await User.findOne({ username: 'demo_alex' })) {
    log.info('Seed data already present — skipping');
    return null;
  }

  const { user: alex } = await registerUser({
    username: 'demo_alex',
    email: 'alex@demo.local',
    password: PASSWORD,
    displayName: 'Alex',
  });

  const { user: robin } = await registerUser({
    username: 'demo_robin',
    email: 'robin@demo.local',
    password: PASSWORD,
    displayName: 'Robin',
  });

  Object.assign(alex, {
    bio: 'Chess, long walks, longer messages.\n1400 and climbing, slowly.',
    countryCode: 'IN',
    pronouns: 'he/him',
    timezone: 'Asia/Kolkata',
    chess: { chesscomUsername: 'alexplays', lichessUsername: 'alexplays' },
  });
  await alex.save();

  Object.assign(robin, {
    bio: 'Endgames and sad songs.',
    countryCode: 'MX',
    pronouns: 'she/her',
    timezone: 'America/Mexico_City',
    chess: { lichessUsername: 'robin_e4' },
  });
  await robin.save();

  const establishedAt = new Date(Date.now() - 14 * 864e5);
  const friendship = await Friendship.create({
    pair: sortPair(alex._id, robin._id),
    status: 'accepted',
    requestedBy: robin._id,
    respondedAt: establishedAt,
    establishedAt,
  });

  const conversation = await Conversation.create({
    type: 'dm',
    participants: friendship.pair,
    friendshipId: friendship._id,
  });

  // Spread the messages across the last two weeks so the date separators and
  // the timeline both have something real to show.
  let last = null;
  for (const [index, [who, body]] of SCRIPT.entries()) {
    const createdAt = new Date(establishedAt.getTime() + (index + 1) * 36e5 * 9);
    last = await Message.create({
      conversationId: conversation._id,
      senderId: who === 'a' ? alex._id : robin._id,
      kind: 'text',
      body,
      createdAt,
    });
  }

  await Message.updateOne(
    { _id: last._id },
    { $push: { reactions: { emoji: '😭', userId: alex._id, at: new Date() } } },
  );

  friendship.stats.messageCount = SCRIPT.length;
  friendship.stats.gamesPlayed = 18;
  friendship.stats.scoreA = 9;
  friendship.stats.scoreB = 9;
  friendship.stats.emojiCounts = new Map([['😭', 4], ['♟', 2]]);
  await friendship.save();

  conversation.lastMessage = {
    messageId: last._id,
    preview: last.body,
    senderId: last.senderId,
    sentAt: last.createdAt,
  };
  await conversation.save();

  const events = [
    ['friendship_started', 'Friendship started', 'The beginning of everything here.', '🤝', 0],
    ['first_message', 'First message', 'Alex said hello.', '💬', 1],
    ['games_played', '18 games', 'Nine each. Nobody is ahead.', '♟', 9],
  ];

  for (const [type, title, description, icon, dayOffset] of events) {
    await timeline.record({
      friendshipId: friendship._id,
      type,
      title,
      description,
      icon,
      occurredAt: new Date(establishedAt.getTime() + dayOffset * 864e5),
      once: type !== 'games_played',
    });
  }

  log.info('Seeded demo accounts:');
  log.info(`  demo_alex  / ${PASSWORD}   (friend code ${alex.friendCode})`);
  log.info(`  demo_robin / ${PASSWORD}   (friend code ${robin.friendCode})`);

  return { alex, robin, conversation };
}
