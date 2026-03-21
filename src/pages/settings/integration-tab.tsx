import { useI18n } from '../../lib/i18n'
import { useAppLayout } from '../../app'
import { Separator } from '@/components/ui/separator'
import { ProviderConfigSection } from './sections/provider-config-section'
import { TaskModelSection } from './sections/task-model-section'
import { SiteAccessSettings } from '../../components/settings/site-access-settings'

export function IntegrationTab() {
  const { settings } = useAppLayout()
  const { t } = useI18n()

  return (
    <>
      <ProviderConfigSection t={t} settings={settings} />
      <Separator />
      <TaskModelSection settings={settings} t={t} />
      <Separator />
      <SiteAccessSettings />
    </>
  )
}
