import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useTranslation } from '../../i18n';
import './index.scss';

export default function PrivacyPage() {
  const { t } = useTranslation();

  const goBack = () => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.redirectTo({ url: '/pages/login/index' });
    });
  };

  return (
    <View className='privacy-page'>
      <View className='privacy-page__bg-glow privacy-page__bg-glow--left' />
      <View className='privacy-page__bg-glow privacy-page__bg-glow--right' />

      <View className='privacy-card'>
        <View className='privacy-card__header'>
          <Text className='privacy-card__back' onClick={goBack}>← {t('common.back')}</Text>
          <Text className='privacy-card__title'>{t('privacy.title')}</Text>
          <Text className='privacy-card__updated'>{t('privacy.lastUpdated')}</Text>
        </View>

        <View className='privacy-card__body'>
          {/* 引言 */}
          <Text className='privacy-card__paragraph'>{t('privacy.intro')}</Text>

          {/* 第一条：信息收集 */}
          <Text className='privacy-card__section-title'>{t('privacy.section1Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section1Desc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('privacy.section1Item1')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section1Item2')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section1Item3')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section1Item4')}</Text>
          </View>

          {/* 第二条：信息用途 */}
          <Text className='privacy-card__section-title'>{t('privacy.section2Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section2Desc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('privacy.section2Item1')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section2Item2')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section2Item3')}</Text>
          </View>

          {/* 第三条：信息存储与安全 */}
          <Text className='privacy-card__section-title'>{t('privacy.section3Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section3Desc')}</Text>

          {/* 第四条：信息共享 */}
          <Text className='privacy-card__section-title'>{t('privacy.section4Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section4Desc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('privacy.section4Item1')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section4Item2')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section4Item3')}</Text>
          </View>

          {/* 第五条：用户权利 */}
          <Text className='privacy-card__section-title'>{t('privacy.section5Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section5Desc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('privacy.section5Item1')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section5Item2')}</Text>
            <Text className='privacy-card__list-item'>• {t('privacy.section5Item3')}</Text>
          </View>

          {/* 第六条：协议变更 */}
          <Text className='privacy-card__section-title'>{t('privacy.section6Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section6Desc')}</Text>

          {/* 第七条：联系方式 */}
          <Text className='privacy-card__section-title'>{t('privacy.section7Title')}</Text>
          <Text className='privacy-card__paragraph'>{t('privacy.section7Desc')}</Text>
        </View>

        <View className='privacy-card__footer'>
          <View className='privacy-card__footer-btn btn-primary' onClick={goBack}>
            <Text>{t('privacy.understood')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
