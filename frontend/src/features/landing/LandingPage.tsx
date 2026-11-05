import { BarChart3, Boxes, BookOpen, Receipt, ShieldCheck, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import khataShot from '@/assets/landing/khata.webp';
import saleShot from '@/assets/landing/simple-sale.webp';
import storeShot from '@/assets/landing/storefront.webp';
import brandMark from '@/assets/brand-mark.webp';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { Button } from '@/components/ui/Button';

import { SampleShop } from './SampleShop';

const CONTACT = {
  email: 'khatrinikace@gmail.com',
  phone: '+977 9861139971',
  tel: 'tel:+9779861139971',
  portfolio: 'https://nikeshkhatri.com.np',
};

const FEATURES = [
  { icon: Receipt, title: 'saleTitle', body: 'saleBody' },
  { icon: Boxes, title: 'stockTitle', body: 'stockBody' },
  { icon: BookOpen, title: 'khataTitle', body: 'khataBody' },
  { icon: BarChart3, title: 'reportsTitle', body: 'reportsBody' },
  { icon: Store, title: 'storeTitle', body: 'storeBody' },
  { icon: ShieldCheck, title: 'isolationTitle', body: 'isolationBody' },
] as const;

const SHELL = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

/** Public page for hosts with no shop behind them (see isLandingHost). */
export function LandingPage() {
  const { t } = useTranslation();
  const mailto = `mailto:${CONTACT.email}?subject=Mero%20Pasal`;

  const screens = [
    { src: khataShot, alt: t('landing.shotKhataAlt'), caption: t('landing.shotKhataCaption') },
    { src: storeShot, alt: t('landing.shotStoreAlt'), caption: t('landing.shotStoreCaption') },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className={`${SHELL} flex h-16 items-center justify-between gap-4`}>
        <span className="flex items-center gap-2 font-semibold">
          <img src={brandMark} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          {t('landing.brand')}
        </span>
        <LanguageToggle />
      </header>

      <main>
        <section className={`${SHELL} grid items-center gap-10 py-10 lg:grid-cols-[3fr_2fr] lg:py-16`}>
          <div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {t('landing.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t('landing.lead')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="#sample-shop">{t('landing.ctaSample')}</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#contact">{t('landing.ctaContact')}</a>
              </Button>
            </div>
          </div>
          <img
            src={saleShot}
            alt={t('landing.shotSaleAlt')}
            width={1170}
            height={2532}
            className="mx-auto w-full max-w-[17rem] rounded-[1.75rem] border-4 border-foreground/90 shadow-card"
          />
        </section>

        <section className="border-t bg-muted/40 py-12 lg:py-16">
          <div className={SHELL}>
            <h2 className="text-2xl font-bold tracking-tight">{t('landing.featuresTitle')}</h2>
            <ul className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <h3 className="font-semibold">{t(`landing.features.${title}`)}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`landing.features.${body}`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-10 max-w-3xl border-l-4 border-amber-400 pl-4 text-sm">
              {t('landing.irdNote')}
            </p>
          </div>
        </section>

        <section
          id="sample-shop"
          className={`${SHELL} grid scroll-mt-4 gap-8 py-12 lg:grid-cols-[2fr_3fr] lg:py-16`}
        >
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t('landing.sampleTitle')}</h2>
            <p className="mt-3 text-muted-foreground">{t('landing.sampleLead')}</p>
          </div>
          <SampleShop />
        </section>

        <section className="border-t py-12 lg:py-16">
          <div className={SHELL}>
            <h2 className="text-2xl font-bold tracking-tight">{t('landing.screensTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('landing.screensNote')}</p>
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              {screens.map((screen) => (
                <figure key={screen.caption}>
                  <img
                    src={screen.src}
                    alt={screen.alt}
                    width={2000}
                    height={1250}
                    loading="lazy"
                    className="h-auto w-full rounded-lg border shadow-card"
                  />
                  <figcaption className="mt-3 text-sm text-muted-foreground">
                    {screen.caption}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="scroll-mt-4 bg-primary py-12 text-primary-foreground lg:py-16">
          <div className={SHELL}>
            <h2 className="text-3xl font-bold tracking-tight">{t('landing.contactTitle')}</h2>
            <p className="mt-3 max-w-xl">{t('landing.contactBody')}</p>
            <dl className="mt-8 grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-sm opacity-80">{t('landing.contactEmail')}</dt>
                <dd className="mt-1 break-words font-semibold">
                  <a className="underline underline-offset-4" href={mailto}>
                    {CONTACT.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm opacity-80">{t('landing.contactPhone')}</dt>
                <dd className="mt-1 font-semibold">
                  <a className="underline underline-offset-4" href={CONTACT.tel}>
                    {CONTACT.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm opacity-80">{t('landing.contactPortfolio')}</dt>
                <dd className="mt-1 font-semibold">
                  <a
                    className="underline underline-offset-4"
                    href={CONTACT.portfolio}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    nikeshkhatri.com.np
                  </a>
                </dd>
              </div>
            </dl>
            <p className="mt-10 text-sm opacity-80">{t('landing.signInHint')}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
