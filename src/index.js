require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/database');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');

// Create bot instance with webhook to avoid polling conflicts
const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Global variables
let speedDatingActive = false;

// Admin verification function
async function isAdmin(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM admins WHERE username = ?', [username], (err, row) => {
            if (err) {
                logger.error('Error checking admin status:', err);
                resolve(false);
            }
            resolve(!!row);
        });
    });
}

async function isSuperAdmin(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM admins WHERE username = ? AND is_super_admin = 1', [username], (err, row) => {
            if (err) {
                logger.error('Error checking super admin status:', err);
                resolve(false);
            }
            resolve(!!row);
        });
    });
}

// Function to get a random available number
function getRandomAvailableNumber() {
    return new Promise((resolve, reject) => {
        // Get all used numbers
        db.all('SELECT anonymous_id FROM users WHERE anonymous_id IS NOT NULL', (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            // Create set of used numbers
            const usedNumbers = new Set(rows.map(row => parseInt(row.anonymous_id.substring(1))));
            
            // Create array of all possible numbers
            const availableNumbers = [];
            for (let i = 0; i <= 500; i++) {
                if (!usedNumbers.has(i)) {
                    availableNumbers.push(i);
                }
            }

            if (availableNumbers.length === 0) {
                reject(new Error('Tous les numéros sont utilisés'));
                return;
            }

            // Pick random number from available numbers
            const randomIndex = Math.floor(Math.random() * availableNumbers.length);
            const selectedNumber = availableNumbers[randomIndex];
            
            // Format number with leading zeros
            const formattedNumber = `#${String(selectedNumber).padStart(3, '0')}`;
            resolve(formattedNumber);
        });
    });
}

// Command to reset all anonymous IDs
bot.onText(/\/resetallnumbers/, async (msg) => {
    try {
        const username = msg.from.username;
        if (!await isSuperAdmin(username)) {
            return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée au super administrateur.');
        }

        // Get all users
        db.all('SELECT username FROM users', async (err, users) => {
            if (err) {
                logger.error('Error getting users:', err);
                return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la récupération des utilisateurs.');
            }

            // Reset all anonymous IDs to NULL first
            await new Promise((resolve, reject) => {
                db.run('UPDATE users SET anonymous_id = NULL', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            const promises = users.map(user => {
                return new Promise(async (resolve, reject) => {
                    try {
                        const randomNumber = await getRandomAvailableNumber();
                        db.run(
                            'UPDATE users SET anonymous_id = ? WHERE username = ?',
                            [randomNumber, user.username],
                            function(err) {
                                if (err) reject(err);
                                else resolve(user.username);
                            }
                        );
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            try {
                await Promise.all(promises);
                bot.sendMessage(msg.chat.id, '✅ Tous les numéros ont été réattribués aléatoirement avec succès.');
            } catch (error) {
                logger.error('Error resetting numbers:', error);
                bot.sendMessage(msg.chat.id, '❌ Erreur lors de la réinitialisation des numéros : ' + error.message);
            }
        });
    } catch (error) {
        logger.error('Error in /resetallnumbers command:', error);
    }
});

// Modified adduser command to use random numbers
bot.onText(/\/adduser (@\w+)/, async (msg, match) => {
    try {
        const username = msg.from.username;
        if (!(await isAdmin(username))) {
            return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée aux administrateurs.');
        }

        const targetUsername = match[1].replace('@', '');

        try {
            const randomNumber = await getRandomAvailableNumber();
            
            // Get user's telegram_id
            db.get('SELECT telegram_id FROM users WHERE username = ?', [targetUsername], async (err, row) => {
                if (err) {
                    logger.error('Error getting user:', err);
                    return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la recherche de l\'utilisateur.');
                }

                if (!row) {
                    return bot.sendMessage(msg.chat.id, '❌ Utilisateur non trouvé dans la base de données. L\'utilisateur doit d\'abord interagir avec le bot en utilisant /start.');
                }

                // Update user's anonymous_id
                db.run('UPDATE users SET anonymous_id = ? WHERE username = ?', [randomNumber, targetUsername], async function(err) {
                    if (err) {
                        logger.error('Error updating anonymous ID:', err);
                        return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la mise à jour de l\'ID anonyme.');
                    }

                    // Notify the user
                    const notificationMessage = `🎭 *Attribution de votre numéro anonyme*\n\n`
                        + `Un administrateur vous a attribué le numéro : *${randomNumber}*\n\n`
                        + `📝 *Instructions :*\n`
                        + `• Gardez ce numéro précieusement\n`
                        + `• Utilisez-le pour les interactions pendant l'événement\n`
                        + `• Ne le partagez avec personne\n\n`
                        + `🔍 *Commandes utiles :*\n`
                        + `• /id - Pour revoir votre numéro à tout moment\n`
                        + `• /help - Pour voir toutes les commandes disponibles\n\n`
                        + `À bientôt à l'événement ! 🎉`;

                    try {
                        await bot.sendMessage(row.telegram_id, notificationMessage, {
                            parse_mode: 'Markdown'
                        });
                        bot.sendMessage(msg.chat.id, `✅ ID anonyme ${randomNumber} attribué à @${targetUsername} et notification envoyée.`);
                    } catch (error) {
                        logger.error('Error sending notification:', error);
                        bot.sendMessage(msg.chat.id, `✅ ID anonyme ${randomNumber} attribué à @${targetUsername}\n⚠️ Impossible d'envoyer la notification à l'utilisateur. Il devra utiliser /id pour voir son numéro.`);
                    }
                });
            });
        } catch (error) {
            if (error.message === 'Tous les numéros sont utilisés') {
                bot.sendMessage(msg.chat.id, '❌ Tous les numéros disponibles sont déjà utilisés.');
            } else {
                logger.error('Error getting random number:', error);
                bot.sendMessage(msg.chat.id, '❌ Erreur lors de l\'attribution du numéro.');
            }
        }
    } catch (error) {
        logger.error('Error in /adduser command:', error);
    }
});

// Command to check own ID
bot.onText(/\/id/, async (msg) => {
    try {
        const username = msg.from.username;
        if (!username) {
            return bot.sendMessage(msg.chat.id, '❌ Vous devez définir un nom d\'utilisateur Telegram pour utiliser ce bot.');
        }
        
        // Get user's anonymous ID from database
        db.get('SELECT anonymous_id, is_admin, is_super_admin FROM users WHERE username = ?', [username], async (err, row) => {
            if (err) {
                logger.error('Error getting anonymous ID:', err);
                return bot.sendMessage(msg.chat.id, '❌ Une erreur est survenue lors de la récupération de votre ID.');
            }

            if (!row || !row.anonymous_id) {
                return bot.sendMessage(msg.chat.id, '❌ Vous n\'avez pas encore d\'ID anonyme attribué.');
            }

            let message = `🎭 *Votre numéro anonyme*\n\n`
                + `Votre numéro est : *${row.anonymous_id}*\n\n`
                + `Gardez ce numéro précieusement, il vous servira pendant l'événement !\n\n`
                + `_Rappel : Ne partagez jamais votre numéro avec d'autres participants._\n\n`;

            // Add admin commands if user is admin
            if (row.is_admin || row.is_super_admin) {
                message += `\n👑 *Commandes administrateur :*\n`;
                message += `• /adduser @pseudo - Attribuer un numéro à un utilisateur\n`;
                if (row.is_super_admin) {
                    message += `• /broadcast - Envoyer le message de bienvenue dans le canal\n`;
                    message += `• /makeadmin @pseudo - Promouvoir un utilisateur en administrateur\n`;
                }
            }

            bot.sendMessage(msg.chat.id, message, {
                parse_mode: 'Markdown'
            });
        });
    } catch (error) {
        logger.error('Error in /id command:', error);
    }
});

// Function to get next available number
function getNextAvailableNumber() {
    return new Promise((resolve, reject) => {
        db.all('SELECT anonymous_id FROM users WHERE anonymous_id IS NOT NULL ORDER BY anonymous_id DESC LIMIT 1', (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            if (rows.length === 0) {
                resolve('#000');
                return;
            }

            const lastNumber = parseInt(rows[0].anonymous_id.substring(1));
            if (lastNumber >= 500) {
                reject(new Error('Limite de 500 utilisateurs atteinte'));
                return;
            }

            const nextNumber = String(lastNumber + 1).padStart(3, '0');
            resolve(`#${nextNumber}`);
        });
    });
}

// Command to check countdown
bot.onText(/\/countdown/, async (msg) => {
    const now = new Date();
    const timeLeft = EVENT_START - now;

    if (now >= EVENT_START && now <= EVENT_END) {
        bot.sendMessage(msg.chat.id, '🎉 L\'événement est en cours ! Profitez-en jusqu\'à 22h !');
    } else if (now > EVENT_END) {
        bot.sendMessage(msg.chat.id, '⌛ L\'événement est terminé. À la prochaine !');
    } else {
        const countdown = formatCountdown(EVENT_START);
        bot.sendMessage(msg.chat.id, `⏳ L'événement commence dans ${countdown} !`);
    }
});

// Command handlers
bot.onText(/\/start/, async (msg) => {
    try {
        const userId = msg.from.id;
        const username = msg.from.username;

        // Check for pending notifications
        db.get('SELECT * FROM notifications WHERE username = ?', [username], async (err, notification) => {
            if (err) {
                logger.error('Error checking notifications:', err);
                return;
            }

            if (notification && notification.type === 'new_id') {
                const data = JSON.parse(notification.data);
                const notificationMessage = `🎭 *Attribution de votre numéro anonyme*\n\n`
                    + `Un administrateur vous a attribué le numéro : *${data.id}*\n\n`
                    + `📝 *Instructions :*\n`
                    + `• Gardez ce numéro précieusement\n`
                    + `• Utilisez-le pour les interactions pendant l'événement\n`
                    + `• Ne le partagez avec personne\n\n`
                    + `🔍 *Commandes utiles :*\n`
                    + `• /id - Pour revoir votre numéro à tout moment\n`
                    + `• /help - Pour voir toutes les commandes disponibles\n\n`
                    + `À bientôt à l'événement ! 🎉`;

                await bot.sendMessage(msg.chat.id, notificationMessage, {
                    parse_mode: 'Markdown'
                });

                // Remove the notification
                db.run('DELETE FROM notifications WHERE username = ? AND type = ?', [username, 'new_id']);
            }
        });

        // Check if user is admin
        const isUserAdmin = await isAdmin(username);
        const isUserSuperAdmin = await isSuperAdmin(username);

        // Register user in database
        db.run(
            'INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)',
            [userId, username],
            async (err) => {
                if (err) {
                    logger.error('Error registering user:', err);
                    return bot.sendMessage(userId, '❌ Une erreur est survenue lors de l\'enregistrement.');
                }

                // Get user's anonymous ID if they have one
                db.get('SELECT anonymous_id FROM users WHERE username = ?', [username], async (err, row) => {
                    if (err) {
                        logger.error('Error getting anonymous ID:', err);
                        return;
                    }

                    // Send event banner first
                    try {
                        await bot.sendPhoto(userId, EVENT_BANNER_URL, {
                            caption: '🎉 Pool-A-Palooza - Édition Love Island 🏝️\nDimanche 16 mars au Ranch du Comté, Ste Rose',
                            parse_mode: 'Markdown'
                        });
                    } catch (error) {
                        logger.error('Error sending photo:', error);
                    }

                    // Send initial welcome message with countdown
                    let welcomeMessage = WELCOME_MESSAGE;
                    welcomeMessage += `\n\n${formatCountdown(EVENT_START)}`;

                    if (row && row.anonymous_id) {
                        welcomeMessage += `\n\n🎭 Votre numéro anonyme est : ${row.anonymous_id}`;
                    }

                    // Add command list based on user role
                    welcomeMessage += '\n\n_Commandes disponibles :_\n';
                    welcomeMessage += '• /contact @pseudo ou #numéro - Envoyer une demande de contact\n';
                    welcomeMessage += '• /report @pseudo - Signaler un utilisateur suspect\n';
                    welcomeMessage += '• /countdown - Voir le temps restant avant l\'événement\n';
                    welcomeMessage += '• /help - Afficher l\'aide';

                    if (isUserSuperAdmin) {
                        welcomeMessage += '\n\n👑 _Commandes Super Admin :_\n';
                        welcomeMessage += '• /addadmin @pseudo - Ajouter un administrateur\n';
                        welcomeMessage += '• /removeadmin @pseudo - Retirer un administrateur\n';
                        welcomeMessage += '• /startspeed - Démarrer une session\n';
                        welcomeMessage += '• /stopspeed - Arrêter la session\n';
                        welcomeMessage += '• /adduser @pseudo - Attribuer un ID anonyme\n';
                        welcomeMessage += '• /resetallnumbers - Réinitialiser tous les numéros';
                    } else if (isUserAdmin) {
                        welcomeMessage += '\n\n👨‍💼 _Commandes Admin :_\n';
                        welcomeMessage += '• /startspeed - Démarrer une session\n';
                        welcomeMessage += '• /stopspeed - Arrêter la session\n';
                        welcomeMessage += '• /adduser @pseudo - Attribuer un ID anonyme';
                    }

                    const sentMessage = await bot.sendMessage(userId, welcomeMessage, { 
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });

                    // Update countdown every 10 seconds
                    const countdownInterval = setInterval(async () => {
                        try {
                            let updatedMessage = WELCOME_MESSAGE;
                            updatedMessage += `\n\n${formatCountdown(EVENT_START)}`;

                            if (row && row.anonymous_id) {
                                updatedMessage += `\n\n🎭 Votre numéro anonyme est : ${row.anonymous_id}`;
                            }

                            // Add command list based on user role
                            updatedMessage += '\n\n_Commandes disponibles :_\n';
                            updatedMessage += '• /contact @pseudo ou #numéro - Envoyer une demande de contact\n';
                            updatedMessage += '• /report @pseudo - Signaler un utilisateur suspect\n';
                            updatedMessage += '• /countdown - Voir le temps restant avant l\'événement\n';
                            updatedMessage += '• /help - Afficher l\'aide';

                            if (isUserSuperAdmin) {
                                updatedMessage += '\n\n👑 _Commandes Super Admin :_\n';
                                updatedMessage += '• /addadmin @pseudo - Ajouter un administrateur\n';
                                updatedMessage += '• /removeadmin @pseudo - Retirer un administrateur\n';
                                updatedMessage += '• /startspeed - Démarrer une session\n';
                                updatedMessage += '• /stopspeed - Arrêter la session\n';
                                updatedMessage += '• /adduser @pseudo - Attribuer un ID anonyme\n';
                                updatedMessage += '• /resetallnumbers - Réinitialiser tous les numéros';
                            } else if (isUserAdmin) {
                                updatedMessage += '\n\n👨‍💼 _Commandes Admin :_\n';
                                updatedMessage += '• /startspeed - Démarrer une session\n';
                                updatedMessage += '• /stopspeed - Arrêter la session\n';
                                updatedMessage += '• /adduser @pseudo - Attribuer un ID anonyme';
                            }

                            await bot.editMessageText(updatedMessage, {
                                chat_id: userId,
                                message_id: sentMessage.message_id,
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true
                            });
                        } catch (error) {
                            logger.error('Error updating countdown:', error);
                            clearInterval(countdownInterval);
                        }
                    }, 10000); // Update every 10 seconds

                    // Clear interval after 1 hour to avoid resource waste
                    setTimeout(() => {
                        clearInterval(countdownInterval);
                    }, 3600000); // 1 hour
                });
            }
        );
    } catch (error) {
        logger.error('Error in /start command:', error);
    }
});

// Handle contact requests
bot.onText(/\/contact (@\w+|#\d+)/, async (msg, match) => {
    try {
        const fromId = msg.from.id;
        const targetIdentifier = match[1];

        // Check if user has an anonymous ID
        db.get('SELECT anonymous_id FROM users WHERE telegram_id = ?', [fromId], async (err, fromUser) => {
            if (err) {
                logger.error('Database error:', err);
                return bot.sendMessage(fromId, '❌ Une erreur est survenue.');
            }

            if (!fromUser || !fromUser.anonymous_id) {
                return bot.sendMessage(fromId, '❌ Vous devez avoir un numéro anonyme pour contacter quelqu\'un. Demandez à un administrateur de vous en attribuer un.');
            }

            // Find target user
            let query, params;
            if (targetIdentifier.startsWith('@')) {
                // Search by username
                query = 'SELECT telegram_id, anonymous_id, username FROM users WHERE username = ?';
                params = [targetIdentifier.substring(1)];
            } else {
                // Search by anonymous ID
                query = 'SELECT telegram_id, anonymous_id, username FROM users WHERE anonymous_id = ?';
                params = [targetIdentifier.substring(1)]; // Remove the # from the number
            }

            db.get(query, params, async (err, targetUser) => {
                if (err) {
                    logger.error('Database error:', err);
                    return bot.sendMessage(fromId, '❌ Une erreur est survenue.');
                }

                if (!targetUser) {
                    return bot.sendMessage(fromId, '❌ Utilisateur non trouvé.');
                }

                if (targetUser.telegram_id === fromId) {
                    return bot.sendMessage(fromId, '❌ Vous ne pouvez pas vous contacter vous-même.');
                }

                // Check if there's already a pending request
                db.get(
                    'SELECT * FROM contact_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
                    [fromId, targetUser.telegram_id, targetUser.telegram_id, fromId],
                    async (err, existingRequest) => {
                        if (err) {
                            logger.error('Database error:', err);
                            return bot.sendMessage(fromId, '❌ Une erreur est survenue.');
                        }

                        if (existingRequest) {
                            return bot.sendMessage(fromId, '❌ Une demande de contact est déjà en cours avec cet utilisateur.');
                        }

                        // Create contact request
                        const keyboard = {
                            inline_keyboard: [
                                [
                                    { text: '✅ Accepter', callback_data: `accept_${fromId}` },
                                    { text: '❌ Refuser', callback_data: `reject_${fromId}` }
                                ]
                            ]
                        };

                        // Send request to target user
                        const requestMessage = `🤝 *Nouvelle demande de contact*\n\n`
                            + `Le participant #${fromUser.anonymous_id} souhaite entrer en contact avec vous.\n\n`
                            + `Souhaitez-vous accepter cette demande ?`;

                        try {
                            await bot.sendMessage(targetUser.telegram_id, requestMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: keyboard
                            });

                            // Notify sender
                            bot.sendMessage(fromId, `✅ Demande de contact envoyée au participant #${targetUser.anonymous_id}.\n\nVous serez notifié de sa réponse.`);

                            // Store request in database
                            db.run(
                                'INSERT INTO contact_requests (from_id, to_id, status) VALUES (?, ?, ?)',
                                [fromId, targetUser.telegram_id, 'pending'],
                                (err) => {
                                    if (err) {
                                        logger.error('Error storing contact request:', err);
                                    }
                                }
                            );
                        } catch (error) {
                            logger.error('Error sending contact request:', error);
                            bot.sendMessage(fromId, '❌ Impossible d\'envoyer la demande de contact.');
                        }
                    }
                );
            });
        });
    } catch (error) {
        logger.error('Error in contact command:', error);
        bot.sendMessage(msg.chat.id, '❌ Une erreur est survenue lors du traitement de votre demande.');
    }
});

// Admin commands
bot.onText(/\/addadmin (@\w+)/, async (msg, match) => {
    const username = msg.from.username;
    if (!await isSuperAdmin(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée au super administrateur.');
    }

    const newAdminUsername = match[1].replace('@', '');
    
    // First, ensure the user exists in the users table
    db.get('SELECT username FROM users WHERE username = ?', [newAdminUsername], (err, row) => {
        if (err) {
            logger.error('Error checking user:', err);
            return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la vérification de l\'utilisateur.');
        }

        if (!row) {
            // If user doesn't exist, create it first
            db.run('INSERT INTO users (username) VALUES (?)', [newAdminUsername], (err) => {
                if (err) {
                    logger.error('Error creating user:', err);
                    return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la création de l\'utilisateur.');
                }

                // Now add as admin
                addAdminRole();
            });
        } else {
            // User exists, add as admin
            addAdminRole();
        }
    });

    function addAdminRole() {
        db.run('INSERT OR IGNORE INTO admins (username) VALUES (?)', [newAdminUsername], function(err) {
            if (err) {
                logger.error('Error adding admin:', err);
                return bot.sendMessage(msg.chat.id, '❌ Erreur lors de l\'ajout de l\'administrateur.');
            }
            bot.sendMessage(msg.chat.id, `✅ @${newAdminUsername} est maintenant administrateur.`);
        });
    }
});

bot.onText(/\/removeadmin (@\w+)/, async (msg, match) => {
    const username = msg.from.username;
    if (!await isSuperAdmin(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée au super administrateur.');
    }

    const adminUsername = match[1].replace('@', '');
    
    db.run('DELETE FROM admins WHERE username = ? AND is_super_admin = 0', [adminUsername], function(err) {
        if (err) {
            logger.error('Error removing admin:', err);
            return bot.sendMessage(msg.chat.id, '❌ Erreur lors de la suppression de l\'administrateur.');
        }
        if (this.changes === 0) {
            return bot.sendMessage(msg.chat.id, '❌ Administrateur non trouvé ou super administrateur.');
        }
        bot.sendMessage(msg.chat.id, `✅ @${adminUsername} n'est plus administrateur.`);
    });
});

// Start speed dating session
bot.onText(/\/startspeed/, async (msg) => {
    const username = msg.from.username;
    if (!await isAdmin(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée aux administrateurs.');
    }
    
    speedDatingActive = true;
    bot.sendMessage(msg.chat.id, '✅ Session de speed dating activée!');
});

// Stop speed dating session
bot.onText(/\/stopspeed/, async (msg) => {
    const username = msg.from.username;
    if (!await isAdmin(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée aux administrateurs.');
    }
    
    speedDatingActive = false;
    bot.sendMessage(msg.chat.id, '🛑 Session de speed dating terminée!');
});

// Message handler
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        if (!speedDatingActive) {
            return bot.sendMessage(msg.chat.id, '⚠️ Le speed dating n\'est pas actif. Attendez qu\'un administrateur lance une session.');
        }
    }
});

// Handle inline keyboard callbacks
bot.on('callback_query', async (callbackQuery) => {
    try {
        const action = callbackQuery.data.split('_')[0];
        const requestId = callbackQuery.data.split('_')[1];
        const userId = callbackQuery.from.id;

        if (action === 'accept' || action === 'reject') {
            db.get(
                'SELECT * FROM contact_requests WHERE id = ?',
                [requestId],
                async (err, request) => {
                    if (err || !request) {
                        logger.error('Error fetching contact request:', err);
                        return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Requête invalide' });
                    }

                    if (action === 'accept') {
                        // Share contact information
                        db.get(
                            'SELECT username FROM users WHERE telegram_id = ?',
                            [request.from_user_id],
                            async (err, fromUser) => {
                                if (err) {
                                    logger.error('Error fetching user info:', err);
                                    return;
                                }

                                bot.sendMessage(request.from_user_id, `✨ Votre demande a été acceptée! Username: @${callbackQuery.from.username}`);
                                bot.sendMessage(userId, `✨ Vous avez accepté la demande de @${fromUser.username}`);
                            }
                        );
                    } else {
                        bot.sendMessage(request.from_user_id, '❌ Votre demande a été refusée.');
                        bot.sendMessage(userId, '✅ Vous avez refusé la demande.');
                    }

                    // Update request status
                    db.run(
                        'UPDATE contact_requests SET status = ? WHERE id = ?',
                        [action === 'accept' ? 'accepted' : 'rejected', requestId]
                    );

                    bot.answerCallbackQuery(callbackQuery.id);
                }
            );
        }
    } catch (error) {
        logger.error('Error in callback query:', error);
    }
});

// Handle reports
bot.onText(/\/report (@\w+)/, async (msg, match) => {
    try {
        const reporterId = msg.from.id;
        const reportedUsername = match[1].replace('@', '');

        db.get(
            'SELECT telegram_id, anonymous_id FROM users WHERE username = ?',
            [reportedUsername],
            async (err, row) => {
                if (err || !row) {
                    return bot.sendMessage(reporterId, '❌ Utilisateur non trouvé.');
                }

                db.run(
                    'INSERT INTO reports (reporter_id, reported_id) VALUES (?, ?)',
                    [reporterId, row.telegram_id],
                    async (err) => {
                        if (err) {
                            logger.error('Error creating report:', err);
                            return bot.sendMessage(reporterId, '❌ Impossible de créer le signalement.');
                        }

                        // Notify reporter
                        bot.sendMessage(reporterId, '✅ Signalement enregistré. Merci de nous aider à maintenir la communauté sûre.');

                        // Notify all admins
                        const adminMessage = `🚨 Nouveau signalement!\n\n` +
                            `Utilisateur signalé: @${reportedUsername}\n` +
                            `ID anonyme: ${row.anonymous_id}\n` +
                            `Par: ${msg.from.username || 'Anonyme'}`;
                        
                        db.each('SELECT telegram_id FROM admins', [], (err, admin) => {
                            if (!err && admin.telegram_id) {
                                bot.sendMessage(admin.telegram_id, adminMessage);
                            }
                        });
                    }
                );
            }
        );
    } catch (error) {
        logger.error('Error in /report command:', error);
    }
});

// Welcome message template
const WELCOME_MESSAGE = `Salut les participant(e)s ! Bienvenue sur notre bot Telegram, le QG des rencontres cools et anonymes ! 

_Le concept est simple :_

• Chaque participant(e) a un numéro secret
• Tu veux discuter avec quelqu'un ? Utilise la commande /contact @son\\_pseudo ou /contact #son\\_numéro
• La personne reçoit une notif et choisit si elle accepte ou pas
• Si c'est un match, on vous met en contact !

_Les règles d'or :_

• _Respectez-vous !_ Ici, on est là pour faire des rencontres sympas, pas pour draguer lourdement ou harceler
• _Confidentialité avant tout !_ Ne partagez pas d'infos perso (numéro de tel, adresse, etc.) tant que vous ne connaissez pas bien la personne
• _Pas de contenu inapproprié !_ On veut garder une ambiance safe et fun pour tout le monde
• _En cas de problème :_ Utilisez la commande /report @pseudo pour signaler tout comportement suspect

_Quelques tips :_

• Sois créatif(ve) dans tes messages, ça donne plus envie de répondre !
• N'hésite pas à utiliser les groupes de discussion pour faire connaissance avant de contacter quelqu'un en privé
• Amuse-toi, c'est le but !`;

// Event start date
const EVENT_START = new Date('2025-03-16T12:00:00-04:00');
const EVENT_END = new Date('2025-03-16T22:00:00-04:00');

// Event banner URL - À remplacer par le lien direct de l'image
const EVENT_BANNER_URL = 'https://imgur.com/a/bUW6qcP';  // Remplacez cette URL par le lien direct de votre image

// Function to format countdown
function formatCountdown(targetDate) {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
        return "L'événement a commencé ! 🎉";
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `⏰ Compte à rebours:\n${days}j ${hours}h ${minutes}m ${seconds}s`;
}

// Channel configuration
const CHANNEL_ID = -1002481834752;

// Function to broadcast welcome message to channel
async function broadcastWelcomeMessage() {
    try {
        // First, send the event banner
        try {
            await bot.sendPhoto(CHANNEL_ID, EVENT_BANNER_URL, {
                caption: '🎉 *Pool-A-Palooza - Édition Love Island* 🏝️\n'
                    + '📍 Dimanche 16 mars au Ranch du Comté, Ste Rose',
                parse_mode: 'Markdown'
            });
        } catch (error) {
            logger.error('Error sending banner image:', error);
            logger.error('Image URL used:', EVENT_BANNER_URL);
            // Continue with text message even if image fails
        }

        // Send welcome message with countdown
        let channelMessage = `🎉 *Pool-A-Palooza - Édition Love Island* 🏝️\n`;
        channelMessage += `📍 Dimanche 16 mars au Ranch du Comté, Ste Rose\n\n`;
        channelMessage += `${formatCountdown(EVENT_START)}\n\n`;
        channelMessage += WELCOME_MESSAGE;

        // Add basic commands
        channelMessage += '\n\n_Commandes disponibles :_\n';
        channelMessage += '• /contact @pseudo ou #numéro - Envoyer une demande de contact\n';
        channelMessage += '• /report @pseudo - Signaler un utilisateur suspect\n';
        channelMessage += '• /countdown - Voir le temps restant avant l\'événement\n';
        channelMessage += '• /help - Afficher l\'aide';

        const sentMessage = await bot.sendMessage(CHANNEL_ID, channelMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });

        // Update countdown every 10 seconds
        const countdownInterval = setInterval(async () => {
            try {
                let updatedMessage = `🎉 *Pool-A-Palooza - Édition Love Island* 🏝️\n`;
                updatedMessage += `📍 Dimanche 16 mars au Ranch du Comté, Ste Rose\n\n`;
                updatedMessage += `${formatCountdown(EVENT_START)}\n\n`;
                updatedMessage += WELCOME_MESSAGE;

                // Add basic commands
                updatedMessage += '\n\n_Commandes disponibles :_\n';
                updatedMessage += '• /contact @pseudo ou #numéro - Envoyer une demande de contact\n';
                updatedMessage += '• /report @pseudo - Signaler un utilisateur suspect\n';
                updatedMessage += '• /countdown - Voir le temps restant avant l\'événement\n';
                updatedMessage += '• /help - Afficher l\'aide';

                await bot.editMessageText(updatedMessage, {
                    chat_id: CHANNEL_ID,
                    message_id: sentMessage.message_id,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
            } catch (error) {
                logger.error('Error updating channel countdown:', error);
                clearInterval(countdownInterval);
            }
        }, 10000);

        // Clear interval after 1 hour
        setTimeout(() => {
            clearInterval(countdownInterval);
        }, 3600000);

        return sentMessage;
    } catch (error) {
        logger.error('Error broadcasting welcome message:', error);
        throw error;
    }
}

// Command to manually broadcast welcome message
bot.onText(/\/broadcast/, async (msg) => {
    try {
        const username = msg.from.username;
        if (!await isSuperAdmin(username)) {
            return bot.sendMessage(msg.chat.id, '❌ Cette commande est réservée au super administrateur.');
        }
        
        await broadcastWelcomeMessage();
        bot.sendMessage(msg.chat.id, '✅ Message diffusé dans le canal avec succès.');
    } catch (error) {
        logger.error('Error in broadcast command:', error);
        bot.sendMessage(msg.chat.id, '❌ Erreur lors de la diffusion du message.');
    }
});

// Broadcast welcome message when bot starts
broadcastWelcomeMessage();

// Broadcast welcome message every day at 9:00 AM
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
        broadcastWelcomeMessage();
    }
}, 60000); // Check every minute

// Error handling
bot.on('polling_error', (error) => {
    logger.error('Polling error:', error);
});

logger.info('Bot started successfully!');
