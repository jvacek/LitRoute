from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0003_user_language"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="receive_ty_emails",
            field=models.BooleanField(default=True),
        ),
    ]
