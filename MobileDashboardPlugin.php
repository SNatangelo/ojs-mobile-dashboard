<?php

/**
 * @file MobileDashboardPlugin.php
 *
 * Copyright (C) 2026 Stefano Natangelo
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @class MobileDashboardPlugin
 *
 * @brief Makes the OJS back end usable on a phone (slide-out menu, pages that
 *  fit the screen, tables shown as cards). Site-wide plugin: it applies to all
 *  journals and to the site administration pages. It has no settings, and
 *  above 900 px nothing changes.
 */

namespace APP\plugins\generic\mobileDashboard;

use APP\core\Application;
use APP\template\TemplateManager;
use PKP\core\PKPPageRouter;
use PKP\plugins\GenericPlugin;
use PKP\plugins\Hook;

class MobileDashboardPlugin extends GenericPlugin
{
    /** ?v= suffix of the asset URLs, computed once per request */
    private ?string $assetVersion = null;

    public function getDisplayName()
    {
        return __('plugins.generic.mobileDashboard.displayName');
    }

    public function getDescription()
    {
        return __('plugins.generic.mobileDashboard.description');
    }

    public function isSitePlugin()
    {
        return true;
    }

    public function register($category, $path, $mainContextId = null)
    {
        if (!parent::register($category, $path, $mainContextId)) {
            return false;
        }
        if (Application::isUnderMaintenance()) {
            return true;
        }
        if ($this->getEnabled()) {
            Hook::add('TemplateManager::display', $this->addAssets(...));
        }
        return true;
    }

    public function addAssets(string $hookName, array $args): bool
    {
        $request = Application::get()->getRequest();
        if (!$request->getRouter() instanceof PKPPageRouter) {
            return false;
        }
        /** @var TemplateManager $templateMgr */
        $templateMgr = $args[0];
        $base = $request->getBaseUrl() . '/' . $this->getPluginPath() . '/styles/';
        // The version in the URL makes phones fetch the new files after an upgrade
        $this->assetVersion ??= '?v=' . rawurlencode(($this->getCurrentVersion() ?: null)?->getVersionString() ?? '1');
        $v = $this->assetVersion;

        $templateMgr->addStyleSheet('mobileDashboard', $base . 'mobile.css' . $v, ['contexts' => ['backend']]);
        $templateMgr->addJavaScript('mobileDashboard', $base . 'mobile.js' . $v, ['contexts' => ['backend']]);
        return false;
    }
}
