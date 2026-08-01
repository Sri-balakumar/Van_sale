{
    'name': 'Privilege Manager Apps',
    'version': '19.0.5.5.0',
    'category': 'Administration',
    'summary': 'Granular user privileges + app feature gating (standalone parallel build with .app-suffixed models)',
    'description': """
        Privilege Manager Apps
        ======================
        Standalone parallel build of User Privilege Manager. Provides the same
        functionality (granular user-level CRUD privileges, hide menus, hide
        modules, group-based privileges, React Native app feature gating, OWL
        dashboard) but with separately-named models (suffixed with ``.app``) so
        it can be installed alongside the original ``user_privilege_manager_``
        module without any name or table collisions.

        Features:
        ---------
        * Per-user, per-model CRUD privileges on ``user.privilege.app``
        * Module-level privileges with master toggles (``module.privilege.app``)
        * Hide menus per user (``menu.privilege.app``)
        * Hide app icons per user (``module.visibility.app``)
        * Privilege Groups (``privilege.role.app``) with auto-created Odoo groups
        * React Native app feature gating (``app.feature.app`` / ``app.feature.visibility.app``)
        * Backend CRUD enforcement (BaseModel mixin)
        * Frontend enforcement (view-arch injection)
        * Admin OWL dashboard for managing everything
        * Bulk privilege wizards
    """,
    'author': 'Alphalize Technologies',
    'website': 'https://www.alphalize.com',
    'license': 'LGPL-3',
    'depends': ['base', 'web'],
    'data': [
        'security/security_groups.xml',
        'security/ir.model.access.csv',
        'wizard/role_add_models_wizard_views.xml',
        'wizard/privilege_bulk_wizard_views.xml',
        'views/user_privilege_views.xml',
        'views/privilege_role_views.xml',
        'views/module_privilege_views.xml',
        'views/module_visibility_views.xml',
        'views/menu_privilege_views.xml',
        'views/user_privilege_app_feature_views.xml',
        'views/dashboard_action.xml',
        'views/res_users_views.xml',
        'views/menu.xml',
        'data/user_privilege_app_feature_data.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'user_privilege_manager_apps/static/src/css/privilege_dashboard.css',
            'user_privilege_manager_apps/static/src/js/privilege_controller.js',
            'user_privilege_manager_apps/static/src/js/privilege_dashboard.js',
            'user_privilege_manager_apps/static/src/js/navbar_patch.js',
            'user_privilege_manager_apps/static/src/xml/privilege_templates.xml',
        ],
    },
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': True,
    'auto_install': False,
}
