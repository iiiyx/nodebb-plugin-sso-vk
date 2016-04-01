define('admin/plugins/sso-vkontakte', ['settings'], function(Settings) {
  'use strict';
  /* globals $, app, socket, require */

  var ACP = {};

  ACP.init = function() {
    console.log('derp');
    Settings.load('sso-vkontakte', $('.sso-vkontakte-settings'));

    $('#save').on('click', function() {
      console.log('clicked');
      Settings.save('sso-vkontakte', $('.sso-vkontakte-settings'), function() {
        console.log('saved');
        app.alert({
          type: 'success',
          alert_id: 'sso-vkontakte-saved',
          title: 'Settings Saved',
          message: 'Please reload your NodeBB to apply these settings',
          clickfn: function() {
            socket.emit('admin.reload');
          }
        });
      });
    });
  };

  return ACP;
});