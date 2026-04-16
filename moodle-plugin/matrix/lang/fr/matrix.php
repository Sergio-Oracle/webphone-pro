<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Traductions françaises pour mod_matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

// ── Métadonnées du plugin ─────────────────────────────────────────────────────
$string['pluginname']           = 'Chat Matrix';
$string['modulename']           = 'Chat Matrix';
$string['modulenameplural']     = 'Chats Matrix';
$string['pluginadministration'] = 'Administration du Chat Matrix';
$string['modulename_help']      = 'L\'activité Chat Matrix permet aux étudiants et aux enseignants de communiquer en temps réel via un salon Matrix intégré directement dans Moodle.';

// ── Formulaire de l'activité ──────────────────────────────────────────────────
$string['activityname']          = 'Nom de l\'activité';
$string['roomsettings']          = 'Paramètres du salon Matrix';
$string['roomalias']             = 'Alias du salon';
$string['roomalias_help']        = 'La partie locale de l\'alias Matrix du salon (sans le # et :serveur). Laissez vide pour générer automatiquement. Exemple : moodle-info-l1';
$string['roomalias_hint']        = 'L\'alias complet sera : #{alias}:{$a}';
$string['roomalias_invalid']     = 'L\'alias ne peut contenir que des minuscules, chiffres, tirets (-) et points (.).';
$string['roomid']                = 'ID du salon (avancé)';
$string['roomid_help']           = 'L\'identifiant interne Matrix du salon (commence par !). Laissez vide, il sera rempli automatiquement à la création du salon. Vous pouvez aussi coller ici l\'ID d\'un salon existant.';
$string['autocreateroom']        = 'Créer le salon automatiquement';
$string['autocreateroom_desc']   = 'Crée automatiquement le salon Matrix sur le serveur lors de l\'enregistrement de l\'activité.';
$string['autocreateroom_help']   = 'Si activé, le plugin appellera l\'API Matrix pour créer un salon avec l\'alias ci-dessus. Nécessite un token administrateur valide dans les réglages du plugin.';
$string['autoinviteusers']       = 'Ajouter automatiquement les inscrits';
$string['autoinviteusers_desc']  = 'Ajoute automatiquement tous les utilisateurs inscrits au cours dans le salon Matrix.';
$string['autoinviteusers_help']  = 'Lorsqu\'un étudiant ouvre cette activité, il est directement ajouté au salon Matrix sans avoir besoin d\'accepter une invitation.';
$string['displaymode']           = 'Mode d\'affichage';
$string['displaymode_help']      = 'Choisissez comment le client Matrix est affiché aux utilisateurs. Le mode "Intégré" nécessite que le serveur client Matrix autorise l\'intégration en iframe (X-Frame-Options / CSP frame-ancestors). Si l\'iframe est bloquée, utilisez "Nouvelle fenêtre" ou "Redirection".';
$string['displaymode_iframe']    = 'Intégré (iframe)';
$string['displaymode_newwindow'] = 'Ouvrir dans une nouvelle fenêtre';
$string['displaymode_redirect']  = 'Rediriger directement vers le client';
$string['iframeheight']          = 'Hauteur de l\'iframe (px)';
$string['iframeheight_min']      = 'La hauteur doit être d\'au moins 200 pixels.';

// ── Page de visualisation ─────────────────────────────────────────────────────
$string['roomaddress']      = 'Adresse du salon :';
$string['notconfigured']    = 'Le Chat Matrix n\'est pas encore configuré. Veuillez demander à votre administrateur de renseigner l\'URL du serveur et le token administrateur dans les réglages du plugin.';
$string['notconfigured_client'] = 'L\'URL du client Matrix n\'est pas configurée. Veuillez demander à votre administrateur de renseigner le champ « URL du client Matrix » dans les réglages du plugin.';
$string['loading']          = 'Chargement du Chat Matrix…';
$string['openinnewwindow']  = 'Ouvrir dans une nouvelle fenêtre';
$string['launchchat']       = 'Ouvrir le Chat Matrix';
$string['syncmembers']      = 'Synchroniser les membres';
$string['syncmembers_hint'] = 'Ajouter de force tous les inscrits dans ce salon Matrix.';
$string['syncmembers_done'] = 'Membres synchronisés avec succès.';

// ── Réglages admin ────────────────────────────────────────────────────────────
$string['settings_connection']      = 'Connexion au serveur Matrix';
$string['settings_connection_desc'] = 'Configurez la connexion à votre serveur Matrix (Synapse, Conduit, Dendrite, etc.).';

$string['homeserver_url']      = 'URL du serveur Matrix';
$string['homeserver_url_desc'] = 'L\'URL de base de votre serveur Matrix. Exemple : <code>https://matrix.exemple.fr</code>';

$string['homeserver_domain']             = 'Domaine du serveur Matrix';
$string['homeserver_domain_desc']        = 'Le nom de serveur Matrix utilisé dans les identifiants et les alias de salon. Exemple : <code>exemple.fr</code>';
$string['homeserver_domain_placeholder'] = 'votre-serveur';

$string['client_url']      = 'URL du client Matrix';
$string['client_url_desc'] = 'URL du client web Matrix (Element, SENDT, Cinny, etc.). Exemple : <code>https://chat.exemple.fr</code>';

$string['admin_token']      = 'Token d\'accès administrateur';
$string['admin_token_desc'] = 'Token d\'accès d\'un compte administrateur Matrix. Utilisé pour créer des salons, provisionner les comptes utilisateurs et générer des tokens de connexion automatique (SSO). Obtenez-le via le panneau d\'administration de votre serveur ou avec : <code>curl -X POST https://&lt;serveur&gt;/_matrix/client/v3/login -d \'{"type":"m.login.password","user":"@admin:&lt;domaine&gt;","password":"MOT_DE_PASSE"}\'</code>';

$string['settings_usermapping']      = 'Correspondance des utilisateurs';
$string['settings_usermapping_desc'] = 'Comment les comptes Moodle sont convertis en identifiants Matrix.';

$string['username_format']          = 'Format du nom d\'utilisateur Matrix';
$string['username_format_desc']     = 'Quel champ Moodle utiliser comme partie locale de l\'identifiant Matrix (ex. @<b>username</b>:serveur).';
$string['username_format_username'] = 'Nom d\'utilisateur Moodle';
$string['username_format_email']    = 'Adresse e-mail (partie avant le @)';
$string['username_format_idnumber'] = 'Numéro d\'identification';

$string['settings_token']      = 'Session / token';
$string['settings_token_desc'] = 'Configurez la durée de validité des tokens de connexion SSO. Des tokens plus longs = moins de reconnexions ; des tokens plus courts = plus sécurisés. 8 heures est un bon équilibre pour une journée scolaire.';

$string['token_lifetime']      = 'Durée de validité du token SSO';
$string['token_lifetime_desc'] = 'Durée pendant laquelle le token de connexion Synapse reste valide. L\'iframe se rafraîchit automatiquement 5 minutes avant l\'expiration pour éviter toute déconnexion en cours de session.';
$string['token_lifetime_1h']   = '1 heure';
$string['token_lifetime_4h']   = '4 heures';
$string['token_lifetime_8h']   = '8 heures (recommandé)';
$string['token_lifetime_12h']  = '12 heures';
$string['token_lifetime_24h']  = '24 heures';

$string['settings_security']   = 'Sécurité';
$string['allow_iframe']        = 'Autoriser l\'intégration en iframe';
$string['allow_iframe_desc']   = 'Lorsqu\'activé, le client Matrix est intégré dans les pages Moodle via une iframe. Désactivez si votre serveur client Matrix envoie X-Frame-Options: DENY ou une CSP restrictive qui empêche l\'intégration, et utilisez le mode "Nouvelle fenêtre" à la place.';

$string['settings_advanced']      = 'Avancé / réseau';
$string['settings_advanced_desc'] = 'Paramètres réseau fins. Les valeurs par défaut conviennent à la majorité des déploiements.';

$string['api_timeout']      = 'Délai d\'attente API (secondes)';
$string['api_timeout_desc'] = 'Temps maximum d\'attente d\'une réponse du serveur. Augmentez cette valeur sur les réseaux lents ou à haute latence.';

$string['ssl_verify']      = 'Vérifier le certificat SSL';
$string['ssl_verify_desc'] = 'Vérifie le certificat TLS du serveur Matrix. <strong>Désactivez uniquement sur les serveurs de développement local avec des certificats auto-signés.</strong> Ne jamais désactiver en production.';

$string['settings_test']      = 'Test de connexion';
$string['settings_test_desc'] = 'Utilisez le bouton ci-dessous pour vérifier que Moodle peut atteindre votre serveur Matrix avec le token configuré.';
$string['test_connection']         = 'Lancer les diagnostics';
$string['test_connection_success'] = 'Connexion réussie ! Connecté en tant que : {$a}';
$string['test_connection_failure'] = 'Échec de la connexion : {$a}';

// ── Page de diagnostics ───────────────────────────────────────────────────────
$string['diag_config']           = 'Configuration';
$string['diag_setting']          = 'Paramètre';
$string['diag_value']            = 'Valeur / statut';
$string['diag_goto_settings']    = 'Modifier les réglages';
$string['diag_missing_required'] = 'L\'URL du serveur et le token administrateur doivent tous deux être renseignés avant d\'effectuer les tests.';
$string['diag_tests']            = 'Tests en direct';
$string['diag_test_whoami']      = 'Test 1 — API Client Matrix (whoami)';
$string['diag_test_admin']       = 'Test 2 — API Admin Synapse (version du serveur)';
$string['diag_admin_ok']         = 'API admin Synapse accessible. Version du serveur : {$a}';
$string['diag_admin_fail']       = 'API admin Synapse inaccessible : {$a}. La génération de tokens SSO et l\'ajout forcé des membres ne fonctionneront pas.';
$string['diag_ssl_disabled']     = 'La vérification du certificat SSL est DÉSACTIVÉE. Ceci n\'est sûr que dans des environnements locaux/développement.';
$string['diag_iframe_disabled']  = 'L\'intégration en iframe est désactivée dans les réglages du plugin. Les activités configurées en mode "Intégré" afficheront un bouton à la place.';

// ── Capacités ─────────────────────────────────────────────────────────────────
$string['matrix:view']          = 'Voir l\'activité Chat Matrix';
$string['matrix:addinstance']   = 'Ajouter une activité Chat Matrix';
$string['matrix:managemembers'] = 'Gérer les membres du salon Matrix';

// ── Événements ────────────────────────────────────────────────────────────────
$string['eventcoursemoduleviewed'] = 'Activité Chat Matrix consultée';

// ── Confidentialité (RGPD) ────────────────────────────────────────────────────
$string['privacy:metadata:matrix_rooms']            = 'Informations sur les salons Matrix liés aux cours Moodle.';
$string['privacy:metadata:matrix_rooms:room_id']    = 'L\'identifiant du salon Matrix.';
$string['privacy:metadata:matrix_rooms:room_alias'] = 'L\'alias du salon Matrix.';
$string['privacy:metadata:external_matrix']         = 'Le plugin communique avec un serveur Matrix externe. L\'identifiant Matrix de l\'utilisateur (dérivé de son nom d\'utilisateur Moodle) est transmis au serveur pour la gestion des membres du salon.';
