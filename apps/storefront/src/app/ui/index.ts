/**
 * Storefront design-system primitives — the public surface of `apps/storefront/src/app/ui/`.
 *
 * Authority: `agent_docs/storefront/brand-tokens.md` (the palette,
 * §3 type scale, §7.1 radius), `agent_docs/storefront/a11y-checklist.md`.
 *
 * Every primitive is standalone, OnPush, signal-input-driven, logical-CSS only, and
 * passes axe-core WCAG 2.2 AA in its own Vitest spec.
 */

export {
  AccordionComponent,
  AccordionItemComponent,
  type AccordionMode,
} from './accordion.component';
export { BadgeComponent, type BadgeVariant } from './badge.component';
export { BreadcrumbComponent, type BreadcrumbItem } from './breadcrumb.component';
export {
  ButtonComponent,
  type ButtonSize,
  type ButtonType,
  type ButtonVariant,
} from './button.component';
export { CardComponent, type CardPadding } from './card.component';
export { CheckboxComponent } from './checkbox.component';
export { ChipComponent } from './chip.component';
export { DialogFrameComponent, DialogService } from './dialog.component';
export { DrawerComponent, type DrawerSide } from './drawer.component';
export { EmptyStateComponent } from './empty-state.component';
export { InputComponent, type InputType } from './input.component';
export { PaginationComponent, type PaginationVariant } from './pagination.component';
export { PictureComponent, type PictureSource } from './picture.component';
export { PriceComponent } from './price.component';
export {
  AVAILABILITY_STATE,
  ProductCardComponent,
  type AvailabilityState,
  type ProductAvailability,
  type ProductCardData,
} from './product-card.component';
export { RadioGroupComponent, type RadioOption } from './radio.component';
export { RatingComponent } from './rating.component';
export { SelectComponent, type SelectOption } from './select.component';
export { SkeletonComponent, type SkeletonVariant } from './skeleton.component';
export { SpinnerComponent, type SpinnerSize } from './spinner.component';
export { StepperComponent } from './stepper.component';
export { Toast, ToastContainerComponent, ToastService, type ToastVariant } from './toast.component';
export { TabPanelDirective, TabsComponent, type Tab } from './tabs.component';
export { TextareaComponent } from './textarea.component';
