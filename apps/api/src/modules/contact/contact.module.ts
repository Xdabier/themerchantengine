import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { BotProtectionGuard } from '../../common/bot-protection';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [ConfigModule, MailModule],
  controllers: [ContactController],
  providers: [ContactService, BotProtectionGuard],
})
export class ContactModule {}
