import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OwnerGuard, Permissions, RateLimit, Public } from '@common/decorators';
import { parseLocale } from '@common/interceptors/translatable.interceptor';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { AdminUpdateReviewDto } from './dto/admin-update-review.dto';
import {
  ListReviewsStorefrontDto,
  ListReviewsAdminDto,
  ListQuestionsStorefrontDto,
  ListQuestionsAdminDto,
} from './dto/query-reviews.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { AnswerQuestionAdminDto } from './dto/answer-question-admin.dto';

type AuthedRequest = {
  user: { id: string };
  headers: Record<string, string | string[] | undefined>;
};

function requestLocale(req: AuthedRequest): string {
  const header = req.headers['accept-language'];
  return parseLocale(Array.isArray(header) ? header[0] : header);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOREFRONT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('reviews')
@Controller('v1')
export class ReviewsStorefrontController {
  constructor(private readonly reviews: ReviewsService) {}

  // ── POST /v1/products/:slug/reviews ──────────────────────────────────────

  @Post('products/:slug/reviews')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product review' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  createReview(
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.createReview(slug, dto, req.user.id, requestLocale(req));
  }

  // ── GET /v1/products/:slug/reviews ────────────────────────────────────────

  @Get('products/:slug/reviews')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'List product reviews' })
  @ApiResponse({ status: 200, description: 'Reviews retrieved' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  listReviews(@Param('slug') slug: string, @Query() query: ListReviewsStorefrontDto) {
    return this.reviews.listReviews(slug, query);
  }

  // ── GET /v1/products/:slug/reviews/summary ────────────────────────────────

  @Get('products/:slug/reviews/summary')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get review summary' })
  @ApiResponse({ status: 200, description: 'Summary retrieved' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getReviewSummary(@Param('slug') slug: string) {
    return this.reviews.getReviewSummary(slug);
  }

  // ── GET /v1/products/:slug/reviews/mine ───────────────────────────────────

  @Get('products/:slug/reviews/mine')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: "Get the caller's own review for a product" })
  @ApiResponse({ status: 200, description: 'Own review retrieved (null when none)' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getOwnReview(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    return this.reviews.getOwnReview(slug, req.user.id);
  }

  // ── GET /v1/products/:slug/reviews/eligibility ────────────────────────────

  @Get('products/:slug/reviews/eligibility')
  @OwnerGuard()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Whether the caller may review this product' })
  @ApiResponse({ status: 200, description: 'Eligibility resolved' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getReviewEligibility(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    return this.reviews.getReviewEligibility(slug, req.user.id);
  }

  // ── PATCH /v1/reviews/:id ─────────────────────────────────────────────────

  @Patch('reviews/:id')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update review' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  updateReview(@Param('id') id: string, @Body() dto: UpdateReviewDto, @Req() req: AuthedRequest) {
    return this.reviews.updateReview(id, dto, req.user.id, requestLocale(req));
  }

  // ── DELETE /v1/reviews/:id ────────────────────────────────────────────────

  @Delete('reviews/:id')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete review' })
  @ApiResponse({ status: 204, description: 'Review deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  deleteReview(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.deleteReview(id, req.user.id);
  }

  // ── POST /v1/reviews/:id/helpful ─────────────────────────────────────────

  @Post('reviews/:id/helpful')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark review as helpful' })
  @ApiResponse({ status: 200, description: 'Marked helpful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  toggleHelpfulReview(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.toggleHelpfulReview(id, req.user.id);
  }

  // ── POST /v1/products/:slug/questions ─────────────────────────────────────

  @Post('products/:slug/questions')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product question' })
  @ApiResponse({ status: 201, description: 'Question created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  createQuestion(
    @Param('slug') slug: string,
    @Body() dto: CreateQuestionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.createQuestion(slug, dto, req.user.id, requestLocale(req));
  }

  // ── GET /v1/products/:slug/questions ──────────────────────────────────────

  @Get('products/:slug/questions')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'List product questions' })
  @ApiResponse({ status: 200, description: 'Questions retrieved' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  listQuestions(@Param('slug') slug: string, @Query() query: ListQuestionsStorefrontDto) {
    return this.reviews.listQuestions(slug, query);
  }

  // ── POST /v1/questions/:id/answer ─────────────────────────────────────────
  // Authentication is enforced by the global SessionAuthGuard chain (route is
  // not marked `@Public()`). `@OwnerGuard()` is a SetMetadata-only marker retained
  // for parity with the sibling storefront write routes on this controller —
  // the service intentionally does not enforce ownership of the question
  // entity, since any authenticated user may answer any published question.
  // See production-readiness-audit.md §12.S1.A for the rationale.

  @Post('questions/:id/answer')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Answer product question' })
  @ApiResponse({ status: 200, description: 'Answer added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Question not found' })
  answerQuestion(
    @Param('id') id: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.answerQuestion(id, dto, req.user.id, requestLocale(req));
  }

  // ── POST /v1/questions/:id/helpful ────────────────────────────────────────

  @Post('questions/:id/helpful')
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark question as helpful' })
  @ApiResponse({ status: 200, description: 'Marked helpful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Question not found' })
  toggleHelpfulQuestion(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.toggleHelpfulQuestion(id, req.user.id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('reviews')
@Controller(ADMIN_API_ROUTES.reviews.base)
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsService) {}

  // ── GET /v1/admin/reviews ─────────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.reviews.reviews)
  @Permissions('reviews:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reviews (admin)' })
  @ApiResponse({ status: 200, description: 'Reviews retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listReviews(@Query() query: ListReviewsAdminDto) {
    return this.reviews.listReviewsAdmin(query);
  }

  // ── PATCH /v1/admin/reviews/:id/approve ──────────────────────────────────

  @Patch(ADMIN_API_ROUTES.reviews.reviewApprove)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve review' })
  @ApiResponse({ status: 200, description: 'Review approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  approveReview(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.approveReview(id, req.user.id);
  }

  // ── PATCH /v1/admin/reviews/:id/reject ───────────────────────────────────

  @Patch(ADMIN_API_ROUTES.reviews.reviewReject)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject review' })
  @ApiResponse({ status: 200, description: 'Review rejected' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  rejectReview(@Param('id') id: string, @Body() dto: ModerateReviewDto, @Req() req: AuthedRequest) {
    return this.reviews.rejectReview(id, dto, req.user.id);
  }

  // ── PATCH /v1/admin/reviews/:id ──────────────────────────────────────────
  // Full content edit. Admins may also flip status here in one call.

  @Patch(ADMIN_API_ROUTES.reviews.reviewById)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update review (admin)' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  adminUpdateReview(
    @Param('id') id: string,
    @Body() dto: AdminUpdateReviewDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.adminUpdateReview(id, dto, req.user.id, requestLocale(req));
  }

  // ── DELETE /v1/admin/reviews/:id ─────────────────────────────────────────
  // Hard delete. Customer reviews are deleted permanently with audit trail.

  @Delete(ADMIN_API_ROUTES.reviews.reviewById)
  @Permissions('reviews:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete review (admin)' })
  @ApiResponse({ status: 204, description: 'Review deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  adminDeleteReview(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.adminDeleteReview(id, req.user.id);
  }

  // ── GET /v1/admin/questions ───────────────────────────────────────────────

  @Get(ADMIN_API_ROUTES.reviews.questions)
  @Permissions('reviews:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List questions (admin)' })
  @ApiResponse({ status: 200, description: 'Questions retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listQuestions(@Query() query: ListQuestionsAdminDto) {
    return this.reviews.listQuestionsAdmin(query);
  }

  // ── PATCH /v1/admin/questions/:id/approve ────────────────────────────────

  @Patch(ADMIN_API_ROUTES.reviews.questionApprove)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve question' })
  @ApiResponse({ status: 200, description: 'Question approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Question not found' })
  approveQuestion(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.reviews.approveQuestion(id, req.user.id);
  }

  // ── PATCH /v1/admin/questions/:id/reject ─────────────────────────────────

  @Patch(ADMIN_API_ROUTES.reviews.questionReject)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject question' })
  @ApiResponse({ status: 200, description: 'Question rejected' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Question not found' })
  rejectQuestion(
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.rejectQuestion(id, dto, req.user.id);
  }

  // ── POST /v1/admin/questions/:id/answer ──────────────────────────────────

  @Post(ADMIN_API_ROUTES.reviews.questionAnswer)
  @Permissions('reviews:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Answer product question (admin)' })
  @ApiResponse({ status: 200, description: 'Answer added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Question not found' })
  answerQuestion(
    @Param('id') id: string,
    @Body() dto: AnswerQuestionAdminDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.answerQuestionAdmin(id, dto, req.user.id, requestLocale(req));
  }
}
