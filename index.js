const { MongoClient } = require('mongodb');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
 
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;
 
async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db('chroto-balance');
  console.log('Connected to MongoDB');
}
 
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
 
const SUPER_OWNERS = new Set([1484756542002692139n, 1472661189824872622n]);
const guildPrefixes = {};
const guildOwners = {};
 
function isSuperOwner(userId) {
  return SUPER_OWNERS.has(BigInt(userId));
}
 
async function getPrefix(guildId) {
  if (guildPrefixes[guildId]) return guildPrefixes[guildId];
  const doc = await db.collection('config').findOne({ _id: guildId });
  guildPrefixes[guildId] = doc?.prefix || '+';
  return guildPrefixes[guildId];
}
 
async function savePrefix(guildId, prefix) {
  guildPrefixes[guildId] = prefix;
  await db.collection('config').updateOne(
    { _id: guildId },
    { $set: { prefix } },
    { upsert: true }
  );
}
 
async function getBalance(userId) {
  const doc = await db.collection('balances').findOne({ _id: userId });
  return doc?.balance || 0;
}
 
async function setBalance(userId, amount) {
  await db.collection('balances').updateOne(
    { _id: userId },
    { $set: { balance: amount } },
    { upsert: true }
  );
}
 
async function addBalance(userId, amount) {
  const current = await getBalance(userId);
  await setBalance(userId, current + amount);
  return current + amount;
}
 
client.on('ready', async () => {
  await connectDB();
  console.log(`Bot online as ${client.user.tag}`);
 
  const commands = [
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
    new SlashCommandBuilder()
      .setName('addbalance')
      .setDescription('Add balance to a user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setprefix')
      .setDescription('Set the bot prefix')
      .addStringOption(o => o.setName('prefix').setDescription('New prefix').setRequired(true)),
  ].map(cmd => cmd.toJSON());
 
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});
 
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
 
  const guildId = message.guild.id;
  const prefix = await getPrefix(guildId);
 
  if (!message.content.startsWith(prefix)) return;
 
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
 
  if (command === 'balance') {
    const target = message.mentions.users.first() || message.author;
    const balance = await getBalance(target.id);
    const embed = new EmbedBuilder()
      .setTitle(`💰 Balance`)
      .setDescription(`**${target.username}** has **${balance}** $ worth in balance`)
      .setColor(0x2b2d31);
    await message.reply({ embeds: [embed] });
  }
 
  if (command === 'addbalance') {
    if (!isSuperOwner(message.author.id)) return message.reply('Not authorized.');
    const target = message.mentions.users.first();
    const amount = parseFloat(args[1]);
    if (!target || isNaN(amount)) return message.reply('Usage: `+addbalance @user <amount>`');
    const newBalance = await addBalance(target.id, amount);
    const embed = new EmbedBuilder()
      .setTitle('✅ Balance Added')
      .setDescription(`Added **${amount}** balance to **${target.username}**\nNew balance: **${newBalance}** $`)
      .setColor(0x00aa00);
    await message.reply({ embeds: [embed] });
  }
 
  if (command === 'setprefix') {
    if (!isSuperOwner(message.author.id)) return message.reply('Not authorized.');
    const newPrefix = args[0];
    if (!newPrefix) return message.reply('Please provide a prefix!');
    await savePrefix(guildId, newPrefix);
    await message.reply(`Prefix set to \`${newPrefix}\``);
  }
});
 
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
 
    if (interaction.commandName === 'balance') {
      const target = interaction.options.getUser('user') || interaction.user;
      const balance = await getBalance(target.id);
      const embed = new EmbedBuilder()
        .setTitle('💰 Balance')
        .setDescription(`**${target.username}** has **${balance}** $`)
        .setColor(0x2b2d31);
      await interaction.reply({ embeds: [embed] });
    }
 
    if (interaction.commandName === 'addbalance') {
      if (!isSuperOwner(interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      const newBalance = await addBalance(target.id, amount);
      const embed = new EmbedBuilder()
        .setTitle('✅ Balance Added')
        .setDescription(`Added **${amount}** $ to **${target.username}**\nNew balance: **${newBalance}** $`)
        .setColor(0x00aa00);
      await interaction.reply({ embeds: [embed] });
    }
 
    if (interaction.commandName === 'setprefix') {
      if (!isSuperOwner(interaction.user.id)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const newPrefix = interaction.options.getString('prefix');
      await savePrefix(interaction.guildId, newPrefix);
      await interaction.reply({ content: `Prefix set to \`${newPrefix}\``, ephemeral: true });
    }
  } catch (e) {
    console.log('Interaction error:', e.message);
  }
});
 
client.login(process.env.TOKEN);
 
