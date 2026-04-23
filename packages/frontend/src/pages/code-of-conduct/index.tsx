import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useTranslation } from '../../i18n';
import './index.scss';

export default function CodeOfConductPage() {
  const { t } = useTranslation();

  const goBack = () => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.redirectTo({ url: '/pages/hub/index' });
    });
  };

  return (
    <View className='privacy-page'>
      <View className='privacy-page__bg-glow privacy-page__bg-glow--left' />
      <View className='privacy-page__bg-glow privacy-page__bg-glow--right' />

      <View className='privacy-card'>
        <View className='privacy-card__header'>
          <Text className='privacy-card__back' onClick={goBack}>← {t('common.back')}</Text>
          <Text className='privacy-card__title'>{t('coc.title')}</Text>
          <Text className='privacy-card__updated'>{t('coc.lastUpdated')}</Text>
        </View>

        <View className='privacy-card__body'>
          {/* 关于我们 */}
          <Text className='privacy-card__section-title'>{t('coc.aboutTitle')}</Text>
          <Text className='privacy-card__paragraph'>{t('coc.aboutDesc')}</Text>

          {/* 诚信原则 */}
          <Text className='privacy-card__section-title'>{t('coc.integrityTitle')}</Text>
          <Text className='privacy-card__paragraph'>{t('coc.integrityDesc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.integrityItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.integrityItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.integrityItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.integrityItem4')}</Text>
          </View>

          {/* 尊重原则 */}
          <Text className='privacy-card__section-title'>{t('coc.respectTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.respectItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.respectItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.respectItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.respectItem4')}</Text>
          </View>

          {/* 公平原则 */}
          <Text className='privacy-card__section-title'>{t('coc.fairnessTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.fairnessItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.fairnessItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.fairnessItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.fairnessItem4')}</Text>
          </View>

          {/* 积分与兑换 */}
          <Text className='privacy-card__section-title'>{t('coc.pointsTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.pointsItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.pointsItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.pointsItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.pointsItem4')}</Text>
          </View>

          {/* 内容发布 */}
          <Text className='privacy-card__section-title'>{t('coc.contentTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.contentItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.contentItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.contentItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.contentItem4')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.contentItem5')}</Text>
          </View>

          {/* 差旅赞助 */}
          <Text className='privacy-card__section-title'>{t('coc.travelTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.travelItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.travelItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.travelItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.travelItem4')}</Text>
          </View>

          {/* 违规处理 */}
          <Text className='privacy-card__section-title'>{t('coc.violationTitle')}</Text>
          <Text className='privacy-card__paragraph'>{t('coc.violationDesc')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.violationItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.violationItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.violationItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.violationItem4')}</Text>
          </View>

          {/* 社区权利声明 */}
          <Text className='privacy-card__section-title'>{t('coc.rightsTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem4')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem5')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.rightsItem6')}</Text>
          </View>

          {/* 免责声明 */}
          <Text className='privacy-card__section-title'>{t('coc.disclaimerTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.disclaimerItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.disclaimerItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.disclaimerItem3')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.disclaimerItem4')}</Text>
          </View>

          {/* 联系我们 */}
          <Text className='privacy-card__section-title'>{t('coc.contactTitle')}</Text>
          <Text className='privacy-card__paragraph'>{t('coc.contactDesc')}</Text>

          {/* 生效与修订 */}
          <Text className='privacy-card__section-title'>{t('coc.effectiveTitle')}</Text>
          <View className='privacy-card__list'>
            <Text className='privacy-card__list-item'>• {t('coc.effectiveItem1')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.effectiveItem2')}</Text>
            <Text className='privacy-card__list-item'>• {t('coc.effectiveItem3')}</Text>
          </View>
        </View>

        <View className='privacy-card__footer'>
          <View className='privacy-card__footer-btn btn-primary' onClick={goBack}>
            <Text>{t('coc.understood')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
