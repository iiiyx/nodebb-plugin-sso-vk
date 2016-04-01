(function(module) {
	'use strict';
	/* globals module, require */

	var user = module.parent.require('./user'),
		meta = module.parent.require('./meta'),
		db = module.parent.require('../src/database'),
		passport = module.parent.require('passport'),
		passportVk = require('passport-vkontakte').Strategy,
		nconf = module.parent.require('nconf'),
		async = module.parent.require('async'),
		winston = module.parent.require('winston');

	var authenticationController = module.parent.require('./controllers/authentication');

	var constants = Object.freeze({
		'name': 'Vkontakte',
		'admin': {
			'route': '/plugins/sso-vkontakte',
			'icon': 'vk fa-vk'
		}
	});

	var Vkontakte = {
		settings: undefined
	};

	Vkontakte.init = function(params, callback) {
		function render(req, res) {
			res.render('admin/plugins/sso-vkontakte', {});
		}

		params.router.get('/admin/plugins/sso-vkontakte', params.middleware.admin.buildHeader, render);
		params.router.get('/api/admin/plugins/sso-vkontakte', render);

		callback();
	};

	Vkontakte.getSettings = function(callback) {
		if (Vkontakte.settings) {
			return callback();
		}

		meta.settings.get('sso-vkontakte', function(err, settings) {
			Vkontakte.settings = settings;
			callback();
		});
	}

	Vkontakte.getStrategy = function(strategies, callback) {
		if (!Vkontakte.settings) {
			return Vkontakte.getSettings(function() {
				Vkontakte.getStrategy(strategies, callback);
			});
		}

		if (
			Vkontakte.settings !== undefined
			&& Vkontakte.settings.hasOwnProperty('id') && Vkontakte.settings.id
			&& Vkontakte.settings.hasOwnProperty('secret') && Vkontakte.settings.secret
		) {
			passport.use(new passportVk({
				clientID: Vkontakte.settings.id,
				clientSecret: Vkontakte.settings.secret,
				callbackURL: nconf.get('url') + '/auth/vkontakte/callback',
				passReqToCallback: true,
        profileFields: ['id', 'emails', 'name', 'displayName']
			}, function(req, accessToken, refreshToken, profile, done) {
				//console.log(JSON.stringify(profile));
				if (req.hasOwnProperty('user') && req.user.hasOwnProperty('uid') && req.user.uid > 0) {
					// Save facebook-specific information to the user
					user.setUserField(req.user.uid, 'vkontakteid', profile.id);
					db.setObjectField('vkontakteid:uid', profile.id, req.user.uid);
					return done(null, req.user);
				}

				var email;
				if (profile.hasOwnProperty('email')) {
					email = profile.email;
				} else {
					email = (profile.username ? profile.username : profile.id) + '@users.noreply.vkontakte.com';
				}

				Vkontakte.login(profile.id, profile.displayName, email, profile.photos[0].value, accessToken, refreshToken, profile, function(err, user) {
					//console.log(JSON.stringify(profile));
					if (err) {
						return done(err);
					}
					authenticationController.onSuccessfulLogin(req, user.uid);
					done(null, user);
				});
			}));

			strategies.push({
				name: 'vkontakte',
				url: '/auth/vkontakte',
				callbackURL: '/auth/vkontakte/callback',
				icon: constants.admin.icon,
				scope: 'email'
			});
		}

		callback(null, strategies);
	};

	Vkontakte.getAssociation = function(data, callback) {
		user.getUserField(data.uid, 'vkontakteid', function(err, vkId) {
			if (err) {
				return callback(err, data);
			}

			if (vkId) {
				data.associations.push({
					associated: true,
					url: 'https://vk.com/id' + vkId,
					name: constants.name,
					icon: constants.admin.icon
				});
			} else {
				data.associations.push({
					associated: false,
					url: nconf.get('url') + '/auth/vkontakte',
					name: constants.name,
					icon: constants.admin.icon
				});
			}

			callback(null, data);
		})
	};

	Vkontakte.storeTokens = function(uid, accessToken, refreshToken) {
		//JG: Actually save the useful stuff
		winston.info("Storing received vk access information for uid(" + uid + ") accessToken(" + accessToken + ") refreshToken(" + refreshToken + ")");
		user.setUserField(uid, 'vkaccesstoken', accessToken);
		user.setUserField(uid, 'vkrefreshtoken', refreshToken);
	};

	Vkontakte.login = function(vkontakteid, name, email, picture, accessToken, refreshToken, profile, callback) {

		winston.verbose("Vkontakte.login vkontakteid, name, email, picture: " + vkontakteid + ", " + ", " + name + ", " + email + ", " + picture);

		Vkontakte.getUidByVkid(vkontakteid, function(err, uid) {
			if(err) {
				return callback(err);
			}

			if (uid !== null) {
				// Existing User

				Vkontakte.storeTokens(uid, accessToken, refreshToken);

				callback(null, {
					uid: uid
				});
			} else {
				// New User
				var success = function(uid) {
					// Save facebook-specific information to the user
					user.setUserField(uid, 'vkontakteid', vkontakteid);
					db.setObjectField('vkontakteid:uid', vkontakteid, uid);
					var autoConfirm = Vkontakte.settings && Vkontakte.settings.autoconfirm === "on" ? 1: 0;
					user.setUserField(uid, 'email:confirmed', autoConfirm);

					// Save their photo, if present
					if (picture) {
						user.setUserField(uid, 'uploadedpicture', picture);
						user.setUserField(uid, 'picture', picture);
					}

					Vkontakte.storeTokens(uid, accessToken, refreshToken);

					callback(null, {
						uid: uid
					});
				};

				user.getUidByEmail(email, function(err, uid) {
					if(err) {
						return callback(err);
					}

					if (!uid) {
						user.create({username: name, email: email}, function(err, uid) {
							if(err) {
								return callback(err);
							}

							success(uid);
						});
					} else {
						success(uid); // Existing account -- merge
					}
				});
			}
		});
	};

	Vkontakte.getUidByVkid = function(vkontakteid, callback) {
		db.getObjectField('vkontakteid:uid', vkontakteid, function(err, uid) {
			if (err) {
				return callback(err);
			}
			callback(null, uid);
		});
	};

	Vkontakte.addMenuItem = function(custom_header, callback) {
		custom_header.authentication.push({
			'route': constants.admin.route,
			'icon': constants.admin.icon,
			'name': constants.name
		});

		callback(null, custom_header);
	};

	Vkontakte.deleteUserData = function(data, callback) {
		var uid = data.uid;

		async.waterfall([
			async.apply(user.getUserField, uid, 'vkontakteid'),
			function(oAuthIdToDelete, next) {
				db.deleteObjectField('vkontakteid:uid', oAuthIdToDelete, next);
			}
		], function(err) {
			if (err) {
				winston.error('[sso-vkontakte] Could not remove OAuthId data for uid ' + uid + '. Error: ' + err);
				return callback(err);
			}
			callback(null, uid);
		});
	};

	module.exports = Vkontakte;
}(module));
